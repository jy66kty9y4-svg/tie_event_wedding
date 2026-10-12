const locks = new WeakMap();

// Dialogs may close together or in either order. Restore the background only
// after the last dialog releases it, using the state from before the first one.
export function lockModalBackground(doc) {
  const body = doc.body;
  let lock = locks.get(body);
  if (!lock) {
    const shell = doc.querySelector('.app-shell');
    lock = { count: 0, shell, inert: shell?.inert, overflow: body.style.overflow };
    locks.set(body, lock);
  }
  lock.count++;
  if (lock.shell) lock.shell.inert = true;
  body.style.overflow = 'hidden';
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--lock.count) return;
    if (lock.shell) lock.shell.inert = lock.inert;
    body.style.overflow = lock.overflow;
    locks.delete(body);
  };
}
