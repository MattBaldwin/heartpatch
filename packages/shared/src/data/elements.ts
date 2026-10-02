import type { Element, Feeling } from '../schemas/data/elements.js';

export const ELEMENTS: Element[] = [
  { id: 'fire', name: 'Fire', description: 'Warm, bright and full of crackle.' },
  { id: 'water', name: 'Water', description: 'Splashy, bubbly and always on the move.' },
  { id: 'leaf', name: 'Leaf', description: 'Green, leafy and loves the sunshine.' },
  { id: 'frost', name: 'Frost', description: 'Chilly, sparkly and a little bit sniffly.' },
  { id: 'spark', name: 'Spark', description: 'Fizzy, zippy and full of zap.' },
  { id: 'stone', name: 'Stone', description: 'Sturdy, steady and very good at sitting still.' },
  { id: 'shadow', name: 'Shadow', description: 'Soft, hushed and fond of cozy corners.' },
  { id: 'light', name: 'Light', description: 'Glowy, shiny and happiest at sunrise.' },
];

export const FEELINGS: Feeling[] = [
  { id: 'joy', name: 'Joy', description: 'Bouncy and beaming. Joy squishies love a party!' },
  { id: 'cozy', name: 'Cozy', description: 'Snuggly and warm. Cozy squishies give the best hugs.' },
  { id: 'brave', name: 'Brave', description: 'Puffed up and bold. Brave squishies go first.' },
  { id: 'silly', name: 'Silly', description: 'Wiggly and giggly. Silly squishies spin for fun.' },
  {
    id: 'sleepy',
    name: 'Sleepy',
    description: 'Yawny and calm. Sleepy squishies nod off anywhere.',
  },
  { id: 'spooky', name: 'Spooky', description: 'Goes "boo!" and then giggles about it.' },
];
