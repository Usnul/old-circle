import layout from '../content/layout.json' with {type:'json'};
import {WORLD_VERSION} from './world-definition.mjs';

if(layout.worldVersion!==WORLD_VERSION)throw new Error('Layout needs rebuilding for this world version');
// Consumers add collision solids and presentation state; each gets its own copy.
export function buildLayout(){return structuredClone(layout.data);}
