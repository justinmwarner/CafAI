import type { Route } from '../router.ts';

/**
 * A route's name in the address while the device shares usage (D213): never
 * a bag's id. Settings' list is "settings", each of its groups
 * "settings-coach" and so on (D233).
 */
export function screenOf(route: Route): string {
  switch (route.name) {
    case 'history':
      return route.bagId ? 'history-bag' : 'history';
    case 'settings':
      return route.group ? `settings-${route.group}` : 'settings';
    case 'drink':
      return route.drink === 'hotWater' ? 'hot-water' : route.drink;
    default:
      return route.name;
  }
}
