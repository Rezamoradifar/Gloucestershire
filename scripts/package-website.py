#!/usr/bin/env python3
"""Package a built public frontend into reproducible, checksum-verified text parts."""
from pathlib import Path
import base64,hashlib,io,tarfile,gzip
root=Path(__file__).resolve().parent.parent
site=root/'website/dist'
assert (site/'index.html').is_file(),'Run npm run build --prefix website first'
buf=io.BytesIO()
with tarfile.open(fileobj=buf,mode='w') as tar:
    for file in sorted(site.rglob('*')):
        if file.is_file():
            data=file.read_bytes(); info=tarfile.TarInfo('globaldroptrade-package/site/'+str(file.relative_to(site)));info.size=len(data);info.mode=0o644;tar.addfile(info,io.BytesIO(data))
    data=(root/'scripts/install-website.sh').read_bytes();info=tarfile.TarInfo('globaldroptrade-package/install.sh');info.size=len(data);info.mode=0o755;tar.addfile(info,io.BytesIO(data))
archive=gzip.compress(buf.getvalue(),compresslevel=9,mtime=0)
encoded=base64.b64encode(archive).decode('ascii');parts=root/'website-release-parts';parts.mkdir(exist_ok=True)
for old in parts.glob('*.b64'):old.unlink()
for i,offset in enumerate(range(0,len(encoded),400000)):(parts/f'{i:03d}.b64').write_text(encoded[offset:offset+400000])
(root/'website-release.sha256').write_text(hashlib.sha256(archive).hexdigest()+'  website-release.tar.gz\n')
print(f'Packaged {len(archive)} bytes in {(len(encoded)+399999)//400000} parts')
