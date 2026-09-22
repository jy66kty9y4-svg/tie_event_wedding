const navigationGuards = new Set();

export function registerNavigationGuard(guard) {
  if (typeof guard !== 'function') throw new TypeError('Navigation guard must be a function');
  navigationGuards.add(guard);
  return () => navigationGuards.delete(guard);
}

export function confirmNavigation() {
  for (const guard of [...navigationGuards]) {
    try {
      if (guard() === false) return false;
    } catch {
      return false;
    }
  }
  return true;
}
