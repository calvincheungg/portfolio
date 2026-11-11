// Settings shared by the stage and every toy.

export const NAME = "CALVIN";

// Width (world units) the camera keeps in view, so the name always fits.
export const SCENE_WIDTH = 7.1;

// Depth of the play area; blocks are kept between these so they stay in view.
export const BACK_Z = -1.6;
export const FRONT_Z = 1.4;

/**
 * Collects the GPU resources a toy makes (geometries, materials, textures), so
 * they can all be freed when it's put away: `track(thing)` returns `thing`;
 * `track.disposeAll()` frees everything tracked.
 */
export function createTracker() {
  const things = [];
  const track = (thing) => (things.push(thing), thing);
  track.disposeAll = () => {
    for (const thing of things) thing.dispose();
    things.length = 0;
  };
  return track;
}
