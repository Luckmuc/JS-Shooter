import Game from './game.js';

const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('startBtn');

let game;
startBtn.addEventListener('click', () => {
  overlay.classList.add('hidden');
  if (!game) {
    game = new Game();
    game.start();
    // request pointer lock as part of the user gesture (click)
    game.lockPointer();
  } else {
    game.resume();
    game.lockPointer();
  }
});

// expose for debugging
window.__GAME__ = {
  get: () => game
};
