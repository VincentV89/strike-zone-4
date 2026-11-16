// Public surface of game-audio (domain-entities-game-audio "Module layout").
export { createAudio } from './web/adapter';
export type { AudioDeps, AudioGlobals, AudioContextCtor } from './web/adapter';
export { bindAudioToEvents } from './core/bind';
export { SOUND_CUES } from './core/cues';
export type {
  AudioAdapter,
  AudioBootError,
  AudioLifecycle,
  PlayOptions,
  SoundCue,
  Volumes,
} from './core/types';
