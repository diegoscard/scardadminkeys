export type KeyStatus = 'available' | 'activated' | 'expired';

export interface ManagedDatabase {
  id: number;
  name: string;
  url: string;
  createdAt: string;
}

export interface ActivationKey {
  id: number;
  key: string;
  status: KeyStatus;
  validityDays: number;
  hwid?: string;
  shopName?: string;
  createdAt: string;
  activatedAt?: string;
  expiresAt?: string;
  databaseId?: number;
  database?: ManagedDatabase;
}

export interface AuditLog {
  id: number;
  action: string;
  details?: string;
  createdAt: string;
}

export interface DashboardStats {
  total: number;
  activated: number;
  expired: number;
  systems: number;
}
