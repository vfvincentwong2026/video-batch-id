/**
 * 状态层：Node 内置 node:sqlite（零原生依赖）。
 * PM 裁决：v0.1 用本地 SQLite；Cloudflare D1 在 Tunnel 模式（v0.2+）接入，接口保持参数化。
 */

import { DatabaseSync } from 'node:sqlite';

export type AssetKind = 'master' | 'variant';

export interface AssetRow {
  id: string;
  kind: AssetKind;
  filename: string;
  duration_ms: number | null;
  /** 变体 → 其 Master；Master 为 null */
  parent_id: string | null;
  /** 任务产出的变体 → 其任务 */
  task_id: string | null;
  status: string;
  /** 解析结果 / 变量取值等结构化数据 */
  meta_json: string;
  created_at: string;
}

export interface TaskRow {
  id: string;
  master_asset_id: string;
  matrix_json: string;
  variant_count: number;
  rate_per_variant_usd: number;
  estimated_cost_usd: number;
  status: string;
  created_at: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('master', 'variant')),
  filename TEXT NOT NULL,
  duration_ms INTEGER,
  parent_id TEXT REFERENCES assets(id),
  task_id TEXT REFERENCES tasks(id),
  status TEXT NOT NULL DEFAULT 'uploaded',
  meta_json TEXT NOT NULL DEFAULT '{}',
  file_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  review INTEGER
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  master_asset_id TEXT NOT NULL REFERENCES assets(id),
  matrix_json TEXT NOT NULL,
  variant_count INTEGER NOT NULL CHECK (variant_count > 0),
  rate_per_variant_usd REAL NOT NULL DEFAULT 0.15,
  estimated_cost_usd REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assets_parent ON assets(parent_id);
CREATE INDEX IF NOT EXISTS idx_assets_kind ON assets(kind);
CREATE INDEX IF NOT EXISTS idx_tasks_master ON tasks(master_asset_id);

-- ---- P1 治理表（命名对齐 ai-native-dam infra/migrations，未来平移 Postgres 零改动）----
CREATE TABLE IF NOT EXISTS rights (
  asset_id TEXT PRIMARY KEY REFERENCES assets(id),
  license TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Cleared' CHECK (status IN ('Cleared','Restricted','Expired')),
  channels TEXT NOT NULL DEFAULT '[]',
  territories TEXT NOT NULL DEFAULT '["Global"]',
  embargo_until TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  tool TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  args_json TEXT NOT NULL,
  token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','consumed','expired')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_approvals_resource ON approvals(resource_key, status);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL DEFAULT 'local',
  action TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  cost_usd REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action, created_at);
CREATE TABLE IF NOT EXISTS knowledge_entries (
  id TEXT PRIMARY KEY,
  layer TEXT NOT NULL CHECK (layer IN ('raw','topic','rule','manual','qa')),
  subject_key TEXT NOT NULL,
  content_json TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'auto',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_knowledge_layer ON knowledge_entries(layer, subject_key);
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT 'general',
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS skill_versions (
  skill_id TEXT NOT NULL REFERENCES skills(id),
  version TEXT NOT NULL,
  recipe_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (skill_id, version)
);
`;

/** 轻量迁移：为已存在的库补列（幂等） */
export function migrate(db: DatabaseSync): void {
  const cols = db.prepare(`PRAGMA table_info(assets)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'file_path')) {
    db.exec(`ALTER TABLE assets ADD COLUMN file_path TEXT`);
  }
}

export function openDb(path = ':memory:'): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
