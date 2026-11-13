import express from "express";
import { PrismaClient } from "@prisma/client";
import cors from "cors";
import dotenv from "dotenv";
import pkg from "pg";
const { Client } = pkg;

if (!process.env.VERCEL) {
  dotenv.config({ override: true });
}

// Fallback logic to support common environment variable names provided by users or platforms
if (!process.env.DATABASE_URL) {
  if (process.env.PRISMA_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.PRISMA_DATABASE_URL;
  } else if (process.env.POSTGRES_URL) {
    process.env.DATABASE_URL = process.env.POSTGRES_URL;
  }
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
globalForPrisma.prisma = prisma;

const app = express();

// Middleware to check for DATABASE_URL
app.use((req, res, next) => {
  if (!process.env.DATABASE_URL && req.path.startsWith("/api/")) {
    return res.status(503).json({
      error: "DATABASE_URL missing",
      message:
        "Por favor, configure a variável DATABASE_URL nas configurações do ambiente para conectar ao seu PostgreSQL.",
    });
  }
  next();
});

app.use(cors());
app.use(express.json());

// API Routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Cache para evitar sincronização excessiva (limita a 1 a cada 30s por DB)
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
            keys: [],
          });
        }
        dbKeysMap.get(k.database.id).keys.push(k);
      }
    }

    const now = Date.now();
    const syncPromises = Array.from(dbKeysMap.values()).map(async (dbData) => {
      const lastSync = lastSyncMap.get(dbData.id) || 0;
      if (now - lastSync < 30000 || syncLock.has(dbData.id)) return;

      syncLock.add(dbData.id);

      const client = new Client({
        connectionString: dbData.url,
        connectionTimeoutMillis: 5000,
        ssl: { rejectUnauthorized: false },
      });

      try {
        await client.connect();
        lastSyncMap.set(dbData.id, Date.now());

        const colsRes = await client.query(
          `SELECT column_name FROM information_schema.columns WHERE table_name = 'keys'`
        );
        const colSet = new Set(colsRes.rows.map((r: any) => r.column_name));

        const selectCols = ["key_value"];
        if (colSet.has("status")) selectCols.push("status");
        if (colSet.has("expires_at")) selectCols.push("expires_at");
        if (colSet.has("shop_name")) selectCols.push("shop_name");

        const localKeyValues = dbData.keys.map((k: any) => k.key);
        if (localKeyValues.length === 0) return;

        const extKeys = await client.query(
          `SELECT ${selectCols.join(", ")} FROM keys WHERE key_value = ANY($1)`,
          [localKeyValues]
        );
        const extKeysMap = new Map(extKeys.rows.map((row: any) => [row.key_value, row]));

        const updates: Promise<any>[] = [];
        for (const localKey of dbData.keys) {
          const extData: any = extKeysMap.get(localKey.key);
          if (extData) {
            const dataToUpdate: any = {};

            if (colSet.has("expires_at") && extData.expires_at) {
              const extExpiresAt = new Date(extData.expires_at);
              const localExpiresAt = localKey.expiresAt ? new Date(localKey.expiresAt) : null;
              if (
                !localExpiresAt ||
                Math.abs(extExpiresAt.getTime() - localExpiresAt.getTime()) > 60000
              ) {
                dataToUpdate.expiresAt = extExpiresAt;
              }
            }

            if (colSet.has("shop_name") && extData.shop_name && !localKey.shopName) {
              dataToUpdate.shopName = extData.shop_name;
            }

            const effectiveExpiresAt =
              dataToUpdate.expiresAt ||
              (localKey.expiresAt ? new Date(localKey.expiresAt) : null);
            const isDateExpired = effectiveExpiresAt
              ? effectiveExpiresAt.getTime() <= now
              : false;

            if (colSet.has("status")) {
              if ((extData.status === "expired" || isDateExpired) && localKey.status !== "expired") {
                dataToUpdate.status = "expired";
              } else if (
                extData.status === "active" &&
                !isDateExpired &&
                localKey.status !== "activated"
              ) {
                dataToUpdate.status = "activated";
              }
            } else if (isDateExpired && localKey.status !== "expired") {
              dataToUpdate.status = "expired";
            }

            if (Object.keys(dataToUpdate).length > 0) {
              Object.assign(localKey, dataToUpdate);
              updates.push(
                prisma.licenseKey.update({
                  where: { id: localKey.id },
                  data: dataToUpdate,
                })
              );
            }
          }
        }
        if (updates.length > 0) await Promise.all(updates);
      } catch (err) {
        console.error(`Sync error for DB ${dbData.id}:`, err);
      } finally {
        syncLock.delete(dbData.id);
        try {
          await client.end();
        } catch (e) {}
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
        where: { id: parseInt(databaseId) },
      });

      if (targetDb) {
        const client = new Client({
          connectionString: targetDb.url,
          connectionTimeoutMillis: 5000,
          ssl: { rejectUnauthorized: false },
        });
        try {
          await client.connect();
          await client.query(`
            CREATE TABLE IF NOT EXISTS keys (
              id SERIAL PRIMARY KEY,
              key_value VARCHAR(50) NOT NULL,
              system_id VARCHAR(100) NOT NULL,
              shop_name VARCHAR(255),
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              expires_at TIMESTAMP NOT NULL,
              last_used_at TIMESTAMP
            )
          `);
          try {
            await client.query(
              `ALTER TABLE keys ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active'`
            );
            await client.query(
              `ALTER TABLE keys ADD COLUMN IF NOT EXISTS shop_name VARCHAR(255)`
            );
          } catch (e) {}

          await client.query(
            `INSERT INTO keys (key_value, system_id, shop_name, created_at, expires_at, status) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, $5)`,
            [key, targetDb.name, shopName || null, expiresAt, "active"]
          );
        } finally {
          try {
            await client.end();
          } catch (e) {}
        }
      }
    }

    const newKey = await prisma.licenseKey.create({
      data: {
        key,
        validityDays,
        shopName,
        expiresAt,
        databaseId: databaseId ? parseInt(databaseId) : null,
        status: "activated",
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
      include: { database: true },
    });

    if (!license) {
      return res.status(404).json({ error: "Chave não encontrada" });
    }

    if (license.database?.url) {
      const client = new Client({
        connectionString: license.database.url,
        connectionTimeoutMillis: 5000,
        ssl: { rejectUnauthorized: false },
      });
      try {
        await client.connect();
        await client.query("DELETE FROM keys WHERE key_value = $1", [license.key]);
      } catch (err) {
        console.error(`Falha ao remover chave externa:`, err);
      } finally {
        try {
          await client.end();
        } catch (e) {}
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
      include: { database: true },
    });

    if (key?.database) {
      const client = new Client({
        connectionString: key.database.url,
        connectionTimeoutMillis: 5000,
        ssl: { rejectUnauthorized: false },
      });
      try {
        await client.connect();
        if (status === "expired") {
          await client.query(`UPDATE keys SET status = 'expired' WHERE key_value = $1`, [key.key]);
        } else if (status === "activated") {
          await client.query(`UPDATE keys SET status = 'active' WHERE key_value = $1`, [key.key]);
        } else if (status === "available") {
          await client.query(`UPDATE keys SET status = 'active' WHERE key_value = $1`, [key.key]);
        }
      } catch (err) {
        console.error("Failed to sync status to external DB", err);
      } finally {
        try {
          await client.end();
        } catch (e) {}
      }
    }

    const updated = await prisma.licenseKey.update({
      where: { id: parseInt(id) },
      data: {
        status,
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
      include: { database: true },
    });

    if (!key) throw new Error("Key not found");

    const newValidityDays = Math.max(0, key.validityDays + additionalDays);

    const fallbackStart = new Date(key.createdAt);
    const currentEnd = key.expiresAt
      ? new Date(key.expiresAt)
      : new Date(fallbackStart.getTime() + key.validityDays * 24 * 60 * 60 * 1000);

    const baseTime =
      additionalDays > 0 ? Math.max(currentEnd.getTime(), Date.now()) : currentEnd.getTime();
    const newExpiresAt = new Date(baseTime + additionalDays * 24 * 60 * 60 * 1000);

    const isNowExpired = newExpiresAt.getTime() <= Date.now();
    const finalStatus = isNowExpired ? "expired" : "activated";

    const updated = await prisma.licenseKey.update({
      where: { id: parseInt(id) },
      data: {
        validityDays: newValidityDays,
        expiresAt: newExpiresAt,
        status: finalStatus,
      },
    });

    if (key.database) {
      const client = new Client({
        connectionString: key.database.url,
        connectionTimeoutMillis: 5000,
        ssl: { rejectUnauthorized: false },
      });
      try {
        await client.connect();
        const extStatus = finalStatus === "expired" ? "expired" : "active";
        await client.query(
          `
          UPDATE keys 
          SET expires_at = CASE 
            WHEN $1 > 0 THEN GREATEST(expires_at, CURRENT_TIMESTAMP) + ($1 || ' days')::interval
            ELSE expires_at + ($1 || ' days')::interval
          END,
          status = $2
          WHERE key_value = $3
        `,
          [additionalDays, extStatus, key.key]
        );
      } catch (err) {
        console.error("Failed to sync renewal to external DB", err);
      } finally {
        try {
          await client.end();
        } catch (e) {}
      }
    }

    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Managed Databases (Ecosystem)
app.get("/api/databases", async (req, res) => {
  try {
    const dbs = await prisma.managedDatabase.findMany({
      orderBy: { name: "asc" },
    });
    res.json(dbs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
  try {
    const [total, activated, expired, systems] = await Promise.all([
      prisma.licenseKey.count(),
      prisma.licenseKey.count({ where: { status: "activated" } }),
      prisma.licenseKey.count({ where: { status: "expired" } }),
      prisma.managedDatabase.count(),
    ]);
    res.json({ total, activated, expired, systems });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Activation Endpoint (External Software Use)
app.post("/api/activate", async (req, res) => {
  const { key } = req.body;

  if (!key) {
    return res.status(400).json({ error: "Key is required" });
  }

  try {
    const license = await prisma.licenseKey.findUnique({
      where: { key },
      include: { database: true },
    });

    if (!license) {
      return res.status(404).json({ error: "Invalid license key" });
    }

    if (license.status === "expired") {
      return res.status(403).json({ error: "License key has expired" });
    }

    if (license.status !== "available") {
      return res.json({ status: "already_activated", expiresAt: license.expiresAt });
    }

    const now = new Date();
    const expiresAt =
      license.expiresAt || new Date(now.getTime() + license.validityDays * 24 * 60 * 60 * 1000);

    await prisma.licenseKey.update({
      where: { id: license.id },
      data: {
        status: "activated",
        expiresAt,
      },
    });

    res.json({
      status: "success",
      expiresAt,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default app;
