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

// Logger & Request Debug
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    console.log(`[API] ${req.method} ${req.path}`);
  }
  next();
});

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

// Keys Management
app.get("/api/keys", async (req, res) => {
  const keys = await prisma.licenseKey.findMany({
    include: { database: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(keys);
});

app.post("/api/keys", async (req, res) => {
  const { key, validityDays, databaseId } = req.body;
  try {
    let externalDbName = 'Local Only';
    let expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + validityDays);
    
    if (databaseId) {
      const targetDb = await prisma.managedDatabase.findUnique({
        where: { id: parseInt(databaseId) }
      });
      
      if (targetDb) {
        externalDbName = targetDb.name;
        // Connecting to the external ecosystem database
        const client = new Client({
          connectionString: targetDb.url,
          ssl: { rejectUnauthorized: false }
        });
        await client.connect();
        
        // Creating the target schema dynamically if it doesn't exist (safety fallback)
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
        
        // Inserting the new key straight into the external database "keys" table
        await client.query(
          `INSERT INTO keys (key_value, system_id, created_at, expires_at) VALUES ($1, $2, CURRENT_TIMESTAMP, $3)`,
          [key, externalDbName, expiresAt]
        );
        
        await client.end();
      }
    }

    const newKey = await prisma.licenseKey.create({
      data: {
        key,
        validityDays,
        databaseId: databaseId ? parseInt(databaseId) : null,
      },
    });
    
    await prisma.auditLog.create({
      data: {
        action: "GENERATE_KEY",
        details: `Key ${key} generated and synced directly to ${externalDbName}`,
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
    const deleted = await prisma.licenseKey.delete({ where: { id: parseInt(id) } });
    await prisma.auditLog.create({
      data: { action: "DELETE_KEY", details: `Key ID ${id} was deleted` },
    });
    res.json(deleted);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.patch("/api/keys/:id", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    const updated = await prisma.licenseKey.update({
      where: { id: parseInt(id) },
      data: { status },
    });
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

// Logs
app.get("/api/logs", async (req, res) => {
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(logs);
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

    await prisma.auditLog.create({
      data: {
        action: "KEY_ACTIVATED",
        details: `Key ${key} activated on HWID ${hwid}`,
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
