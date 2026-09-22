export const ROLES = ["OWNER","ADMIN","OPERATOR","VIEWER"] as const;
export type Role = typeof ROLES[number];

export const PERMISSIONS = {
  PRODUCTS_READ: "products:read",
  PRODUCTS_WRITE: "products:write",
  INVENTORY_READ: "inventory:read",
  INVENTORY_WRITE: "inventory:write",
  ORDERS_READ: "orders:read",
  ORDERS_WRITE: "orders:write",
  AUDIT_READ: "audit:read"
} as const;
