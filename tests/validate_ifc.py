# IFC dosyasını IfcOpenShell ile doğrular: python3 tests/validate_ifc.py model.ifc
import sys, ifcopenshell, ifcopenshell.validate, ifcopenshell.geom
f = ifcopenshell.open(sys.argv[1])
logger = ifcopenshell.validate.json_logger()
ifcopenshell.validate.validate(f, logger)
print('schema', f.schema, 'errors', len(logger.statements))
for s in logger.statements[:10]: print(' ', s.get('message', s)[:200] if isinstance(s, dict) else s)
for t in ['IfcWall', 'IfcColumn', 'IfcSlab', 'IfcDoor', 'IfcWindow', 'IfcSpace']:
    print(t, len(f.by_type(t)))
settings = ifcopenshell.geom.settings()
ok = bad = 0
for p in f.by_type('IfcProduct'):
    if not p.Representation: continue
    try: ifcopenshell.geom.create_shape(settings, p); ok += 1
    except Exception as e: bad += 1; print('geom fail', p.is_a(), p.Name, e)
print('geometry ok', ok, 'fail', bad)
sp = f.by_type('IfcSpace')[:3]
print([ (s.Name, s.LongName) for s in sp ])
