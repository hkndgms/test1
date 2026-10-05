// IFC4 (ISO 16739) STEP yazıcı. buildSolids() çıktısını alır, Revit / FreeCAD /
// BlenderBIM'in açabileceği tek katlı bir model üretir.

import { SYSTEMS } from './kb.js';

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
  const projName = P.projectName || fileName.replace(/\.ifc$/i, '').replace(/_/g, ' ') || 'DWG2BIM';
  const project = add(`IFCPROJECT('${ifcGuid()}',$,${stepStr(projName)},$,$,$,$,(${ctx}),${units})`);

  const place = (rel, z = 0) => {
    const pt = z ? add(`IFCCARTESIANPOINT((0.,0.,${real(z)}))`) : origin;
    const ax = add(`IFCAXIS2PLACEMENT3D(${pt},${zDir},${xDir})`);
    return add(`IFCLOCALPLACEMENT(${rel || '$'},${ax})`);
  };
  const sitePl = place(null);
  const site = add(`IFCSITE('${ifcGuid()}',$,'Arsa',$,$,${sitePl},$,$,.ELEMENT.,$,$,$,$,$)`);
  const bldPl = place(sitePl);
  const building = add(`IFCBUILDING('${ifcGuid()}',$,${stepStr(projName)},$,$,${bldPl},$,$,.ELEMENT.,$,$,$)`);
  const elev = P.levelCm / 100;
  const stPl = place(bldPl, elev);
  const storey = add(`IFCBUILDINGSTOREY('${ifcGuid()}',$,${stepStr(P.storeyName)},$,$,${stPl},$,$,.ELEMENT.,${real(elev)})`);
  add(`IFCRELAGGREGATES('${ifcGuid()}',$,$,$,${project},(${site}))`);
  add(`IFCRELAGGREGATES('${ifcGuid()}',$,$,$,${site},(${building}))`);
  add(`IFCRELAGGREGATES('${ifcGuid()}',$,$,$,${building},(${storey}))`);

  const extrudeItem = (profile, depth, z = 0) => {
    const pts = profile.map(([x, y]) => add(`IFCCARTESIANPOINT((${real(x)},${real(y)}))`));
    const pl = add(`IFCPOLYLINE((${pts.join(',')},${pts[0]}))`);
    const prof = add(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${pl})`);
    const pos = z ? add(`IFCAXIS2PLACEMENT3D(${add(`IFCCARTESIANPOINT((0.,0.,${real(z)}))`)},${zDir},${xDir})`) : wcs;
    return add(`IFCEXTRUDEDAREASOLID(${prof},${pos},${zDir},${real(depth)})`);
  };
  const extrude = (profile, depth) => {
    const rep = add(`IFCSHAPEREPRESENTATION(${body},'Body','SweptSolid',(${extrudeItem(profile, depth)}))`);
    return add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${rep}))`);
  };
  // parçalı katı: her parça, elemanın yerleşimine (z = so.z0) göre kendi kotunda ayrı bir katı
  const partsShape = (so) => {
    const items = so.parts.filter((p) => p.profile.length >= 3 && p.z1 - p.z0 > 1e-4).map((p) => extrudeItem(p.profile, p.z1 - p.z0, p.z0 - so.z0));
    if (!items.length) return null;
    const rep = add(`IFCSHAPEREPRESENTATION(${body},'Body','SweptSolid',(${items.join(',')}))`);
    return add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${rep}))`);
  };
  // tefriş türü -> IFC varlığı ve öntanımlı tip
  const FIXTURE_IFC = {
    wc: ['IFCSANITARYTERMINAL', 'TOILETPAN'], squat: ['IFCSANITARYTERMINAL', 'TOILETPAN'], urinal: ['IFCSANITARYTERMINAL', 'URINAL'],
    sink: ['IFCSANITARYTERMINAL', 'WASHHANDBASIN'], ksink: ['IFCSANITARYTERMINAL', 'SINK'], shower: ['IFCSANITARYTERMINAL', 'SHOWER'],
    bathtub: ['IFCSANITARYTERMINAL', 'BATH'], faucet: ['IFCVALVE', 'FAUCET'], drain: ['IFCWASTETERMINAL', 'FLOORTRAP'],
    ac: ['IFCUNITARYEQUIPMENT', 'SPLITSYSTEM'], radiator: ['IFCSPACEHEATER', 'RADIATOR'],
    table: ['IFCFURNITURE', 'TABLE'], desk: ['IFCFURNITURE', 'DESK'], chair: ['IFCFURNITURE', 'CHAIR'], sofa: ['IFCFURNITURE', 'SOFA'],
    bed: ['IFCFURNITURE', 'BED'], cabinet: ['IFCFURNITURE', 'FILECABINET'], counter: ['IFCFURNITURE', 'USERDEFINED'],
    stair: ['IFCSTAIR', 'STRAIGHT_RUN_STAIR'], outlet: ['IFCOUTLET', 'POWEROUTLET'], switch: ['IFCSWITCHINGDEVICE', 'TOGGLESWITCH'],
    light: ['IFCLIGHTFIXTURE', 'POINTSOURCE'], panel: ['IFCELECTRICDISTRIBUTIONBOARD', 'DISTRIBUTIONBOARD'],
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
  const systems = new Map(); // sistem -> eleman listesi
  const dir3 = (v) => add(`IFCDIRECTION((${real(v[0])},${real(v[1])},${real(v[2])}))`);
  const pt3 = (v) => add(`IFCCARTESIANPOINT((${real(v[0])},${real(v[1])},${real(v[2])}))`);
  // Boru: her segment, eksen doğrultusunda uzatılmış bir daire kesit
  const pipeShape = (path, r) => {
    const items = [];
    const prof = add(`IFCCIRCLEPROFILEDEF(.AREA.,$,$,${real(r)})`);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const L = Math.hypot(d[0], d[1], d[2]);
      if (L < 1e-4) continue;
      const u = d.map((x) => x / L);
      const ref = Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      let px = [u[1] * ref[2] - u[2] * ref[1], u[2] * ref[0] - u[0] * ref[2], u[0] * ref[1] - u[1] * ref[0]];
      const pl = Math.hypot(...px); px = px.map((x) => x / pl);
      const pos = add(`IFCAXIS2PLACEMENT3D(${pt3(a)},${dir3(u)},${dir3(px)})`);
      items.push(add(`IFCEXTRUDEDAREASOLID(${prof},${pos},${zDir},${real(L)})`));
    }
    if (!items.length) return null;
    const rep = add(`IFCSHAPEREPRESENTATION(${body},'Body','SweptSolid',(${items.join(',')}))`);
    return add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${rep}))`);
  };
  const MEP_TYPES = new Set(['pipe', 'duct', 'airterminal', 'terminal', 'equipment']);
  for (const so of solids) {
    if (MEP_TYPES.has(so.type)) {
      const sys = SYSTEMS[so.system] || SYSTEMS.other;
      const air = /air|exhaust/.test(so.system || '');
      const g = ifcGuid();
      const nm = stepStr(so.name);
      const tag = stepStr(so.src);
      let e;
      if (so.type === 'pipe') {
        const shape = pipeShape(so.path, so.r);
        if (!shape) continue;
        const pl = place(stPl, 0);
        const elec = so.system === 'electrical' || so.system === 'lowvoltage' || so.system === 'lighting';
        e = elec ? add(`IFCCABLECARRIERSEGMENT('${g}',$,${nm},$,${stepStr(sys.label)},${pl},${shape},${tag},.CONDUITSEGMENT.)`)
          : add(`${air ? 'IFCDUCTSEGMENT' : 'IFCPIPESEGMENT'}('${g}',$,${nm},$,${stepStr(sys.label)},${pl},${shape},${tag},${air ? '.FLEXIBLESEGMENT.' : '.RIGIDSEGMENT.'})`);
      } else {
        if (so.profile.length < 3 || so.z1 - so.z0 <= 1e-4) continue;
        const pl = place(stPl, so.z0);
        const shape = extrude(so.profile, so.z1 - so.z0);
        if (so.type === 'duct') e = add(`IFCDUCTSEGMENT('${g}',$,${nm},$,${stepStr(sys.label)},${pl},${shape},${tag},.RIGIDSEGMENT.)`);
        else if (so.type === 'airterminal') e = add(`IFCAIRTERMINAL('${g}',$,${nm},$,${stepStr(sys.label)},${pl},${shape},${tag},.DIFFUSER.)`);
        else if (so.system === 'fire' && so.type === 'terminal') e = add(`IFCFIRESUPPRESSIONTERMINAL('${g}',$,${nm},$,${stepStr(sys.label)},${pl},${shape},${tag},.SPRINKLER.)`);
        else if (so.system === 'lighting') e = add(`IFCLIGHTFIXTURE('${g}',$,${nm},$,${stepStr(sys.label)},${pl},${shape},${tag},.POINTSOURCE.)`);
        else if (so.system === 'electrical' && so.type === 'terminal') e = add(`IFCOUTLET('${g}',$,${nm},$,${stepStr(sys.label)},${pl},${shape},${tag},.POWEROUTLET.)`);
        else if (so.system === 'electrical' && so.type === 'equipment') e = add(`IFCELECTRICDISTRIBUTIONBOARD('${g}',$,${nm},$,${stepStr(sys.label)},${pl},${shape},${tag},.DISTRIBUTIONBOARD.)`);
        else if (so.system === 'lowvoltage' && so.type === 'terminal') e = add(`IFCSENSOR('${g}',$,${nm},$,${stepStr(sys.label)},${pl},${shape},${tag},.NOTDEFINED.)`);
        else if (so.type === 'terminal') e = add(`IFCVALVE('${g}',$,${nm},$,${stepStr(sys.label)},${pl},${shape},${tag},.NOTDEFINED.)`);
        else if (so.system === 'hvac') e = add(`IFCUNITARYEQUIPMENT('${g}',$,${nm},$,${stepStr(sys.label)},${pl},${shape},${tag},.SPLITSYSTEM.)`);
        else e = add(`IFCFLOWTERMINAL('${g}',$,${nm},$,${stepStr(sys.label)},${pl},${shape},${tag})`);
      }
      const props = { Katman: so.props?.layer, Sistem: sys.label };
      if (so.props?.diaMm) { props.CapMm = so.props.diaMm; props.CapKaynagi = so.props.diaSrc === 'label' ? 'çizimdeki yazı' : 'varsayılan'; }
      if (so.props?.block) props.Blok = so.props.block;
      pset(e, 'DWG2BIM_Tesisat', props);
      contained.push(e);
      const key = so.system || 'other';
      if (!systems.has(key)) systems.set(key, []);
      systems.get(key).push(e);
      continue;
    }
    if (so.profile.length < 3 || so.z1 - so.z0 <= 1e-4) continue;
    const pl = place(stPl, so.z0);
    const shape = so.parts ? partsShape(so) : extrude(so.profile, so.z1 - so.z0);
    if (!shape) continue;
    const g = ifcGuid();
    const nm = stepStr(so.name);
    const tag = stepStr(so.src);
    let e;
    if (so.type === 'door') {
      const op = so.props.leaves === 2 ? '.DOUBLE_DOOR_SINGLE_SWING.' : '.SINGLE_SWING_LEFT.';
      e = add(`IFCDOOR('${g}',$,${nm},$,$,${pl},${shape},${tag},${real(so.props.heightM)},${real(so.props.widthM)},.DOOR.,${op},$)`);
      pset(e, 'Pset_DoorCommon', { IsExternal: !!so.props.exterior });
    } else if (so.type === 'window') {
      const pt = so.props.panels === 1 ? '.SINGLE_PANEL.' : so.props.panels === 2 ? '.DOUBLE_PANEL_VERTICAL.' : '.TRIPLE_PANEL_VERTICAL.';
      e = add(`IFCWINDOW('${g}',$,${nm},$,$,${pl},${shape},${tag},${real(so.props.heightM)},${real(so.props.widthM)},.WINDOW.,${pt},$)`);
      pset(e, 'Pset_WindowCommon', { IsExternal: !!so.props.exterior });
    } else if (so.type === 'curtain') {
      e = add(`IFCCURTAINWALL('${g}',$,${nm},$,'Cam giydirme cephe',${pl},${shape},${tag},.NOTDEFINED.)`);
      pset(e, 'Pset_CurtainWallCommon', { IsExternal: true });
      pset(e, 'DWG2BIM', { UzunlukM: so.props.lengthM, YukseklikM: so.props.heightM });
    } else if (so.type === 'fixture') {
      const [ent, pdt] = FIXTURE_IFC[so.fx] || ['IFCFURNISHINGELEMENT', null];
      e = add(`${ent}('${g}',$,${nm},$,${stepStr(so.props.kind)},${pl},${shape},${tag}${pdt ? `,.${pdt}.` : ''})`);
      pset(e, 'DWG2BIM_Tefris', { Tur: so.props.kind, Blok: so.props.block || null, GenislikCm: so.props.widthCm, DerinlikCm: so.props.depthCm });
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
  for (const [key, elems] of systems) {
    const sys = SYSTEMS[key] || SYSTEMS.other;
    const ds = add(`IFCDISTRIBUTIONSYSTEM('${ifcGuid()}',$,${stepStr(sys.label)},$,$,${stepStr(sys.label)},.${sys.ifc}.)`);
    add(`IFCRELASSIGNSTOGROUP('${ifcGuid()}',$,$,$,(${elems.join(',')}),$,${ds})`);
    add(`IFCRELSERVICESBUILDINGS('${ifcGuid()}',$,$,$,${ds},(${building}))`);
  }

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
