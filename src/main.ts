// Entry point: build the game (scene, physics, character model) and start it.
// See game/game.ts for how everything is wired together and the loop.

import { Game } from './game/game';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const game = await Game.create(canvas);
document.getElementById('loading')?.remove();
game.start();
