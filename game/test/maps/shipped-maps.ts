// Every shipped map runs through the same map-validity suites (BR-WM-73). warehouse-map adds
// its definition here.
import { desertCompound, type MapDefinition } from '@sz/maps';

export const SHIPPED_MAPS: ReadonlyArray<MapDefinition> = [desertCompound];
