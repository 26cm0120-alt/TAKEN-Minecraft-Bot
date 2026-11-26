import {readFileSync} from 'node:fs';
export const dictionary=JSON.parse(readFileSync(new URL('./minecraft-dictionary.json',import.meta.url),'utf8'));
export const normalizeName=name=>String(name).normalize('NFKC').replace(/§./g,'').trim().replace(/^minecraft:/,'').toLowerCase().replace(/[\s_-]/g,'');
export function lookupName(name,kind='items'){
 const raw=String(name).normalize('NFKC').trim().replace(/^minecraft:/,'').toLowerCase(),group=dictionary[kind];
 return Object.hasOwn(group.names,raw)?raw:group.aliases[normalizeName(raw)]||null;
}

export function displayItemName(id){return dictionary.items.names[id]?.japanese?.[0] || dictionary.blocks.names[id]?.japanese?.[0] || id;}
