const JAVA_KEYWORDS = new Set('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null _ record sealed permits var yield'.split(' '));

export function normalize(a){
  while(a<=-Math.PI) a+=2*Math.PI;
  while(a> Math.PI) a-=2*Math.PI;
  return a;
}

export function wrapRadFull(a){           // [0, 2π)
  a = normalize(a);
  return a < 0 ? a + 2*Math.PI : a;
}

export function maybeSnapAngle(rad, snap){
  if(!snap) return rad;
  const step = 15*Math.PI/180;
  return Math.round(rad/step)*step;
}

export function sanitizeJavaIdent(s){
  s = String(s).replace(/[^A-Za-z0-9_]/g, '');
  if (!s) s = 'AutoPath';
  if (!/[A-Za-z_]/.test(s[0])) s = '_' + s;
  if (JAVA_KEYWORDS.has(s)) s = '_' + s;
  return s;
}

export function sanitizeFileBase(s){
  s = String(s).trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_\-]/g, '');
  return s || 'AutoPath';
}

export function mimeForName(name){
  if (name.endsWith('.java')) return 'text/x-java-source';
  if (name.endsWith('.json')) return 'application/json';
  if (name.endsWith('.csv'))  return 'text/csv';
  return 'text/plain';
}
