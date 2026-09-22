export const readableGuestField = (can, table, row, field) =>
  Boolean(field) && can('read', table.id, row.id, field);
