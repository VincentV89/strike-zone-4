// Every shipped map runs through the same map-validity suites (BR-WM-73, BR-WH-50).
import { desertCompound, industrialWarehouse, type MapDefinition } from '@sz/maps';

export const SHIPPED_MAPS: ReadonlyArray<MapDefinition> = [desertCompound, industrialWarehouse];
