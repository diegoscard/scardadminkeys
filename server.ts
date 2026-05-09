import express from "express";
import { PrismaClient } from "@prisma/client";
import cors from "cors";
import path from "path";
import { createServer as createViteServer } from "vite";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import pkg from "pg";
const { Client } = pkg;

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const prisma = new PrismaClient();

// Middleware to check for DATABASE_URL
app.use((req, res, next) => {
  if (!process.env.DATABASE_URL && req.path.startsWith('/api/')) {
    return res.status(503).json({ 
      error: "DATABASE_URL missing", 
      message: "Por favor, configure a variável DATABASE_URL no menu Settings > Secrets para conectar ao seu PostgreSQL." 
    });
  }
  next();
});
const PORT = 3000;

app.use(cors());
app.use(express.json());

// API Routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Cache para evitar sincronização excessiva (limita a 1 por minuto por DB)
const lastSyncMap = new Map<number, number>();
const syncLock = new Set<number>();

// Keys Management
app.get("/api/keys", async (req, res) => {
  try {
    const keys = await prisma.licenseKey.findMany({
      include: { database: true },
      orderBy: { createdAt: "desc" },
    });

    const dbKeysMap = new Map();
    for (const k of keys) {
      if (k.database) {
        if (!dbKeysMap.has(k.database.id)) {
          dbKeysMap.set(k.database.id, {
            id: k.database.id,
            url: k.database.url,
            keys: []
          });
        }
        dbKeysMap.get(k.database.id).keys.push(k);
      }
    }

    const now = Date.now();
    const syncPromises = Array.from(dbKeysMap.values()).map(async (dbData) => {
      // Regra: Sincroniza no máximo a cada 30 segundos para evitar sobrecarga
      const lastSync = lastSyncMap.get(dbData.id) || 0;
      if (now - lastSync < 30000 || syncLock.has(dbData.id)) return;

      syncLock.add(dbData.id);
      lastSyncMap.set(dbData.id, now);

      const client = new Client({
        connectionString: dbData.url,
        connectionTimeoutMillis: 2000,
        ssl: { rejectUnauthorized: false }
      });

      try {
        await client.connect();
        
        let queryStr = 'SELECT key_value, hwid FROM keys WHERE hwid IS NOT NULL';
        const columnCheck = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name='keys' and column_name='status'`).catch(() => ({ rows: [] }));
        if (columnCheck.rows.length > 0) {
           queryStr = 'SELECT key_value, hwid, status FROM keys WHERE hwid IS NOT NULL OR status = \'expired\'';
        }

        const extKeys = await client.query(queryStr);
        const extKeysMap = new Map(extKeys.rows.map(row => [row.key_value, row]));

        const updates = [];
        for (const localKey of dbData.keys) {
          const extData = extKeysMap.get(localKey.key);
          if (extData) {
            const hwid = extData.hwid;
            const status = extData.status;

            if (status === 'expired' && localKey.status !== 'expired') {
               updates.push(prisma.licenseKey.update({
                  where: { id: localKey.id },
                  data: { status: 'expired' }
               }));
            } else if (hwid && (!localKey.hwid || localKey.status === 'available' || localKey.status === 'activated')) {
              // Se o HWID mudou no banco externo, atualizamos localmente
              if (hwid !== localKey.hwid || localKey.status !== 'activated') {
                updates.push(prisma.licenseKey.update({
                  where: { id: localKey.id },
                  data: { 
                    hwid: hwid, 
                    status: 'activated',
                    ...(localKey.activatedAt ? {} : { activatedAt: new Date() })
                  }
                }));
              }
            }
          }
        }
        if (updates.length > 0) await Promise.all(updates);
      } catch (err) {
        // Ignora erros de conexão para não travar a lista principal
      } finally {
        syncLock.delete(dbData.id);
        try { await client.end(); } catch (e) {}
      }
    });

    await Promise.allSettled(syncPromises);
    res.json(keys);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/keys", async (req, res) => {
  const { key, validityDays, databaseId, shopName } = req.body;
  try {
    let expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + validityDays);
    
    if (databaseId) {
      const targetDb = await prisma.managedDatabase.findUnique({
        where: { id: parseInt(databaseId) }
      });
      
      if (targetDb) {
        const client = new Client({
          connectionString: targetDb.url,
          connectionTimeoutMillis: 5000,
          ssl: { rejectUnauthorized: false }
        });
        try {
          await client.connect();
          await client.query(`
            CREATE TABLE IF NOT EXISTS keys (
              id SERIAL PRIMARY KEY,
              key_value VARCHAR(50) NOT NULL,
              system_id VARCHAR(100) NOT NULL,
              hwid VARCHAR(255),
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              expires_at TIMESTAMP NOT NULL,
              last_used_at TIMESTAMP
            )
          `);
          try {
            await client.query(`ALTER TABLE keys ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active'`);
          } catch (e) {}
          
          await client.query(
            `INSERT INTO keys (key_value, system_id, created_at, expires_at, status) VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4)`,
            [key, targetDb.name, expiresAt, 'active']
          );
        } finally {
          try { await client.end(); } catch (e) {}
        }
      }
    }

    const newKey = await prisma.licenseKey.create({
      data: {
        key,
        validityDays,
        shopName,
        databaseId: databaseId ? parseInt(databaseId) : null,
        status: 'activated',
      },
    });
    
    res.status(201).json(newKey);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/keys/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const license = await prisma.licenseKey.findUnique({
      where: { id: parseInt(id) },
      include: { database: true }
    });

    if (!license) {
      return res.status(404).json({ error: "Chave não encontrada" });
    }

    if (license.database?.url) {
      const client = new Client({
        connectionString: license.database.url,
        connectionTimeoutMillis: 5000,
        ssl: { rejectUnauthorized: false }
      });
      try {
        await client.connect();
        await client.query('DELETE FROM keys WHERE key_value = $1', [license.key]);
      } catch (err) {
        console.error(`Falha ao remover chave externa:`, err);
      } finally {
        try { await client.end(); } catch (e) {}
      }
    }

    const deleted = await prisma.licenseKey.delete({ where: { id: parseInt(id) } });
    res.json(deleted);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.patch("/api/keys/:id", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    const key = await prisma.licenseKey.findUnique({
      where: { id: parseInt(id) },
      include: { database: true }
    });

    if (key?.database) {
      const client = new Client({
        connectionString: key.database.url,
        connectionTimeoutMillis: 5000,
        ssl: { rejectUnauthorized: false }
      });
      try {
        await client.connect();
        if (status === 'expired') {
            await client.query(`UPDATE keys SET status = 'expired' WHERE key_value = $1`, [key.key]);
        } else if (status === 'activated') {
            await client.query(`UPDATE keys SET status = 'active' WHERE key_value = $1`, [key.key]);
        } else if (status === 'available') {
            await client.query(`UPDATE keys SET hwid = NULL, status = 'active' WHERE key_value = $1`, [key.key]);
        }
      } catch (err) {
          console.error('Failed to sync status to external DB', err);
      } finally {
        try { await client.end(); } catch (e) {}
      }
    }

    const updated = await prisma.licenseKey.update({
      where: { id: parseInt(id) },
      data: { 
        status,
        ...(status === 'available' ? { hwid: null, activatedAt: null } : {})
      },
    });
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/keys/:id/renew", async (req, res) => {
  const { id } = req.params;
  const { additionalDays } = req.body;
  try {
    const key = await prisma.licenseKey.findUnique({
      where: { id: parseInt(id) },
      include: { database: true }
    });

    if (!key) throw new Error("Key not found");

    const newValidityDays = Math.max(0, key.validityDays + additionalDays);
    
    // Re-calcula status baseado na nova validade
    const start = key.activatedAt ? new Date(key.activatedAt) : new Date(key.createdAt);
    const end = new Date(start.getTime() + newValidityDays * 24 * 60 * 60 * 1000);
    const isNowExpired = end.getTime() <= Date.now();
    const finalStatus = isNowExpired ? 'expired' : 'activated';

    const updated = await prisma.licenseKey.update({
      where: { id: parseInt(id) },
      data: { 
        validityDays: newValidityDays,
        status: finalStatus
      },
    });
    
    if (key.database) {
      const client = new Client({
        connectionString: key.database.url,
        connectionTimeoutMillis: 5000,
        ssl: { rejectUnauthorized: false }
      });
      try {
        await client.connect();
        const extStatus = finalStatus === 'expired' ? 'expired' : 'active';
        await client.query(`
          UPDATE keys 
          SET expires_at = CASE 
            WHEN $1 > 0 THEN GREATEST(expires_at, CURRENT_TIMESTAMP) + ($1 || ' days')::interval
            ELSE expires_at + ($1 || ' days')::interval
          END,
          status = $2
          WHERE key_value = $3
        `, [additionalDays, extStatus, key.key]);
      } catch (err) {
        console.error('Failed to sync renewal to external DB', err);
      } finally {
        try { await client.end(); } catch (e) {}
      }
    }
    
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Managed Databases (Ecosystem)
app.get("/api/databases", async (req, res) => {
  const dbs = await prisma.managedDatabase.findMany({
    orderBy: { name: "asc" },
  });
  res.json(dbs);
});

app.post("/api/databases", async (req, res) => {
  const { name, url } = req.body;
  try {
    const newDb = await prisma.managedDatabase.create({
      data: { name, url },
    });
    res.status(201).json(newDb);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/databases/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.managedDatabase.delete({ where: { id: parseInt(id) } });
    res.status(204).end();
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.put("/api/databases/:id", async (req, res) => {
  const { id } = req.params;
  const { url } = req.body;
  try {
    const updatedDb = await prisma.managedDatabase.update({
      where: { id: parseInt(id) },
      data: { url },
    });
    res.json(updatedDb);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Stats
app.get("/api/stats", async (req, res) => {
  const [total, activated, expired, systems] = await Promise.all([
    prisma.licenseKey.count(),
    prisma.licenseKey.count({ where: { status: "activated" } }),
    prisma.licenseKey.count({ where: { status: "expired" } }),
    prisma.managedDatabase.count(),
  ]);
  res.json({ total, activated, expired, systems });
});

// Activation Endpoint (External Software Use)
app.post("/api/activate", async (req, res) => {
  const { key, hwid } = req.body;
  
  if (!key || !hwid) {
    return res.status(400).json({ error: "Key and HWID are required" });
  }

  try {
    const license = await prisma.licenseKey.findUnique({
      where: { key },
      include: { database: true },
    });

    if (!license) {
      return res.status(404).json({ error: "Invalid license key" });
    }

    if (license.status !== "available") {
      if (license.hwid === hwid) {
        return res.json({ status: "already_activated", expiresAt: license.expiresAt });
      }
      return res.status(403).json({ error: "License already in use on another device" });
    }

    const activatedAt = new Date();
    const expiresAt = new Date();
    expiresAt.setDate(activatedAt.getDate() + license.validityDays);

    const updated = await prisma.licenseKey.update({
      where: { id: license.id },
      data: {
        status: "activated",
        hwid,
        activatedAt,
        expiresAt,
      },
    });

    // Mirroring to external database if exists
    if (license.database) {
      // Note: We don't have the table name, so let's assume it has the same model 'activation' for now
      // Actually, for a real ecosystem, we'd probably have established protocols.
      // I'll leave the sync logic modular so we could insert it into their DB URL.
      // In a real implementation we'd probably use another Prisma constructor or raw pg:
      // const client = new pg.Client({ connectionString: license.database.url });
      // await client.connect();
      // await client.query('INSERT INTO license_keys (key, hwid, expires_at) VALUES ($1, $2, $3)', [key, hwid, expiresAt]);
    }

    res.json({
      status: "success",
      expiresAt,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", async () => {
    console.log(`Server running on http://localhost:${PORT}`);
    
    // Auto-sync database schema on startup if DATABASE_URL is present
    if (process.env.DATABASE_URL) {
      try {
        console.log("Syncing database schema...");
        const { execSync } = await import('child_process');
        execSync('npx prisma db push --skip-generate', { stdio: 'inherit' });
        console.log("Database schema synced successfully.");
      } catch (err) {
        console.error("Database sync failed. This might be due to incorrect DATABASE_URL or network issues.");
        console.error(err);
      }
    }
  });
}

startServer();
