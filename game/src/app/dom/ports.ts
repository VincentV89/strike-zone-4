/**
 * Narrow views of the units app-shell drives. Real objects satisfy them structurally; tests pass
 * counting fakes. Keeping them as Picks of the real interfaces means a renamed method fails here.
 */
import type { AudioAdapter } from '@sz/audio';
import type { InputAdapter } from '@sz/input';
import type { MapId } from '@sz/kernel';
import type { MapCatalog } from '@sz/maps';
import type { NavGraph } from '@sz/nav';
import type { PhysicsHost } from '@sz/physics';
import type { Renderer } from '@sz/render';
import type { Ui } from '@sz/ui';

export type UiPort = Pick<
  Ui,
  | 'showScreen'
  | 'onEvents'
  | 'updateHud'
  | 'radarInput'
  | 'setRadarOutline'
  | 'announce'
  | 'showHudFault'
  | 'resetHud'
  | 'effects'
>;

export type InputPort = Pick<InputAdapter, 'poll' | 'requestLock' | 'releaseLock' | 'setEnabled'>;

export type AudioPort = Pick<
  AudioAdapter,
  'unlock' | 'play' | 'setListener' | 'setVolumes' | 'duck'
>;

export type RendererPort = Pick<Renderer, 'loadMap' | 'beginRound' | 'render' | 'applySettings'>;

export type HostPort = Pick<PhysicsHost, 'load' | 'current' | 'query'>;

/** Everything boot produced (business-logic-model "Boot steps"). */
export interface Booted {
  readonly host: HostPort;
  readonly catalog: MapCatalog;
  /** Built once per map on host.query (FD-AS-6, PD-AS-12). */
  readonly navs: ReadonlyMap<MapId, NavGraph>;
  readonly renderer: RendererPort;
  readonly audio: AudioPort;
  /** The map whose world and scene boot left loaded (the last-used map). */
  readonly loadedMapId: MapId;
}

export type ReportKind = 'fatal' | 'hud' | 'bot' | 'subscriber';

/** The only console.error path (SEC-AS-30), implemented in report.ts. */
export type Report = (kind: ReportKind, err: unknown) => void;
