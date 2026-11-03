import './style.css';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLDivElement;

if (!canvas || !ui) throw new Error('index.html is missing #game or #ui');

// Scaffold only: the game boots in later commits.
canvas.getContext('2d')?.fillRect(0, 0, 1, 1);
