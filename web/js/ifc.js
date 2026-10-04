// IFC4 (ISO 16739) STEP yazıcı. buildSolids() çıktısını alır, Revit / FreeCAD /
// BlenderBIM'in açabileceği tek katlı bir model üretir.

const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

export function ifcGuid() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  // 128 bit -> 22 karakter (ilk karakter 2 bit, sonra 6'şar bit)
  let bits = '';
  for (const x of b) bits += x.toString(2).padStart(8, '0');
  let out = B64[parseInt(bits.slice(0, 2), 2)];
  for (let i = 2; i < 128; i += 6) out += B64[parseInt(bits.slice(i, i + 6), 2)];
  return out;
}

// STEP metni: ASCII dışı karakterler \X2\hhhh\X0\ ile
export function stepStr(s) {
  if (s == null) return '$';
  let out = '';
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (ch === "'") out += "''";
    else if (ch === '\\') out += '\\\\';
    else if (c >= 32 && c < 127) out += ch;
    else if (c < 0x10000) out += '\\X2\\' + c.toString(16).toUpperCase().padStart(4, '0') + '\\X0\\';
  }
  return `'${out}'`;
}

function real(n) {
  if (!Number.isFinite(n)) n = 0;
  let s = (Math.round(n * 1e6) / 1e6).toString();
  if (s.includes('e')) s = n.toFixed(6);
  if (!s.includes('.')) s += '.';
  return s;
}

const TYPE_MAP = {
  wall: { ent: 'IFCWALL', pdt: '.STANDARD.' },
  lintel: { ent: 'IFCWALL', pdt: '.NOTDEFINED.' },
  sill: { ent: 'IFCWALL', pdt: '.NOTDEFINED.' },
  column: { ent: 'IFCCOLUMN', pdt: '.COLUMN.' },
  slab: { ent: 'IFCSLAB', pdt: '.FLOOR.' },
  roof: { ent: 'IFCSLAB', pdt: '.ROOF.' },
};

export function writeIfc(build, { fileName = 'model.ifc', timestamp = new Date() } = {}) {
  const { solids, P } = build;
  const lines = [];
  let id = 0;
  const add = (s) => { lines.push(`#${++id}=${s};`); return `#${id}`; };

  const origin = add('IFCCARTESIANPOINT((0.,0.,0.))');
  const zDir = add('IFCDIRECTION((0.,0.,1.))');
  const xDir = add('IFCDIRECTION((1.,0.,0.))');
  const wcs = add(`IFCAXIS2PLACEMENT3D(${origin},${zDir},${xDir})`);
  const ctx = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${wcs},$)`);
  const body = add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${ctx},$,.MODEL_VIEW.,$)`);
  const u1 = add('IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)');
  const u2 = add('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)');
  const u3 = add('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)');
  const u4 = add('IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)');
  const units = add(`IFCUNITASSIGNMENT((${u1},${u2},${u3},${u4}))`);
  const project = add(`IFCPROJECT('${ifcGuid()}',$,${stepStr(P.projectName)},$,$,$,$,(${ctx}),${units})`);

  const place = (rel, z = 0) => {
    const pt = z ? add(`IFCCARTESIANPOINT((0.,0.,${real(z)}))`) : origin;
    const ax = add(`IFCAXIS2PLACEMENT3D(${pt},${zDir},${xDir})`);
    return add(`IFCLOCALPLACEMENT(${rel || '$'},${ax})`);
  };
  const sitePl = place(null);
  const site = add(`IFCSITE('${ifcGuid()}',$,'Arsa',$,$,${sitePl},$,$,.ELEMENT.,$,$,$,$,$)`);
  const bldPl = place(sitePl);
  const building = add(`IFCBUILDING('${ifcGuid()}',$,${stepStr(P.projectName)},$,$,${bldPl},$,$,.ELEMENT.,$,$,$)`);
  const elev = P.levelCm / 100;
  const stPl = place(bldPl, elev);
  const storey = add(`IFCBUILDINGSTOREY('${ifcGuid()}',$,${stepStr(P.storeyName)},$,$,${stPl},$,$,.ELEMENT.,${real(elev)})`);
  add(`IFCRELAGGREGATES('${ifcGuid()}',$,$,$,${project},(${site}))`);
  add(`IFCRELAGGREGATES('${ifcGuid()}',$,$,$,${site},(${building}))`);
  add(`IFCRELAGGREGATES('${ifcGuid()}',$,$,$,${building},(${storey}))`);

  const extrude = (profile, depth) => {
    const pts = profile.map(([x, y]) => add(`IFCCARTESIANPOINT((${real(x)},${real(y)}))`));
    const pl = add(`IFCPOLYLINE((${pts.join(',')},${pts[0]}))`);
    const prof = add(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${pl})`);
    const solid = add(`IFCEXTRUDEDAREASOLID(${prof},${wcs},${zDir},${real(depth)})`);
    const rep = add(`IFCSHAPEREPRESENTATION(${body},'Body','SweptSolid',(${solid}))`);
    return add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${rep}))`);
  };
  const pset = (target, name, props) => {
    const vals = Object.entries(props).filter(([, v]) => v != null).map(([k, v]) => {
      const t = typeof v === 'boolean' ? `IFCBOOLEAN(.${v ? 'T' : 'F'}.)`
        : typeof v === 'number' ? (k.endsWith('M') || k.endsWith('M2') ? `IFCLENGTHMEASURE(${real(v)})` : `IFCREAL(${real(v)})`)
        : `IFCLABEL(${stepStr(v)})`;
      return add(`IFCPROPERTYSINGLEVALUE(${stepStr(k)},$,${t},$)`);
    });
    if (!vals.length) return;
    const ps = add(`IFCPROPERTYSET('${ifcGuid()}',$,${stepStr(name)},$,(${vals.join(',')}))`);
    add(`IFCRELDEFINESBYPROPERTIES('${ifcGuid()}',$,$,$,(${target}),${ps})`);
  };

  const contained = [];
  const spaces = [];
  for (const so of solids) {
    if (so.profile.length < 3 || so.z1 - so.z0 <= 1e-4) continue;
    const pl = place(stPl, so.z0);
    const shape = extrude(so.profile, so.z1 - so.z0);
    const g = ifcGuid();
    const nm = stepStr(so.name);
    const tag = stepStr(so.src);
    let e;
    if (so.type === 'door') {
      e = add(`IFCDOOR('${g}',$,${nm},$,$,${pl},${shape},${tag},${real(so.props.heightM)},${real(so.props.widthM)},.DOOR.,.SINGLE_SWING_LEFT.,$)`);
      pset(e, 'Pset_DoorCommon', { IsExternal: !!so.props.exterior });
    } else if (so.type === 'window') {
      e = add(`IFCWINDOW('${g}',$,${nm},$,$,${pl},${shape},${tag},${real(so.props.heightM)},${real(so.props.widthM)},.WINDOW.,.SINGLE_PANEL.,$)`);
      pset(e, 'Pset_WindowCommon', { IsExternal: !!so.props.exterior });
    } else if (so.type === 'space') {
      e = add(`IFCSPACE('${g}',$,${tag},$,$,${pl},${shape},${stepStr(so.name || so.src)},.ELEMENT.,.INTERNAL.,$)`);
      pset(e, 'Pset_SpaceCommon', { Reference: so.src });
      pset(e, 'DWG2BIM', { AlanM2: so.props.areaM2 });
      spaces.push(e);
      continue;
    } else {
      const t = TYPE_MAP[so.type];
      e = add(`${t.ent}('${g}',$,${nm},$,${stepStr(so.name)},${pl},${shape},${tag},${t.pdt})`);
      if (so.type === 'wall') {
        pset(e, 'Pset_WallCommon', { IsExternal: so.props.exterior, LoadBearing: false });
        pset(e, 'DWG2BIM', { KalinlikCm: so.props.thicknessCm });
      }
    }
    contained.push(e);
  }
  if (contained.length) add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${ifcGuid()}',$,$,$,(${contained.join(',')}),${storey})`);
  if (spaces.length) add(`IFCRELAGGREGATES('${ifcGuid()}',$,$,$,${storey},(${spaces.join(',')}))`);

  const ts = timestamp.toISOString().slice(0, 19);
  return [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');",
    `FILE_NAME(${stepStr(fileName)},'${ts}',(''),(''),'DWG2BIM','DWG2BIM','');`,
    "FILE_SCHEMA(('IFC4'));",
    'ENDSEC;',
    'DATA;',
    ...lines,
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n');
}
