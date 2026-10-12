import {useEffect, useRef, useState} from 'react';
import {ArrowUpRight, ImageIcon, X, ZoomIn} from 'lucide-react';
import {companyDocuments, type CompanyDocument} from './companyDocuments';
import './company-documents.css';

export default function CompanyDocuments() {
  const [selected, setSelected] = useState<CompanyDocument | null>(null);
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const viewer = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!selected) { viewer.current?.close(); return; }
    const trigger = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    viewer.current?.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [selected]);

  function imageFailed(id: string) {
    setFailedImages(ids => ids.includes(id) ? ids : [...ids, id]);
  }

  return <section className="gdt-wrap gdt-section gdt-company-documents" id="company-documents" aria-labelledby="company-documents-title">
    <div className="gdt-document-heading">
      <div><div className="gdt-eyebrow"><span/>COMPANY DOCUMENTS</div><h2 id="company-documents-title">Company records.<br/><em>Operating documents.</em></h2></div>
      <p>Company registration and operating licence documents, with access to the original files when published.</p>
    </div>
    <div className="gdt-document-grid">
      {companyDocuments.map((item, index) => {
        const doc = item.document;
        const unavailable = failedImages.includes(item.id);
        return <article className="gdt-document-card" key={item.id} aria-labelledby={`${item.id}-title`}>
          <div className="gdt-document-top"><span>{item.label}</span><span>0{index + 1}</span></div>
          {doc && !unavailable ? <button className="gdt-document-image" onClick={() => setSelected(item)} aria-label={`Enlarge ${item.title.toLowerCase()}`}>
            <img src={doc.image} alt={doc.imageAlt} loading="lazy" onError={() => imageFailed(item.id)}/>
            <span><ZoomIn size={17}/>View document</span>
          </button> : <div className="gdt-document-empty">
            <span className="gdt-document-image-mark" aria-hidden="true"><ImageIcon size={34} strokeWidth={1.1}/></span>
            <strong>{doc ? 'Preview unavailable' : 'Document not yet published'}</strong>
            <span>{doc ? 'Use the original file link below.' : 'The document image will appear here.'}</span>
          </div>}
          <div className="gdt-document-caption">
            <h3 id={`${item.id}-title`}>{item.title}</h3>
            {doc ? <>
              {(doc.issuer || doc.reference) && <dl>{doc.issuer && <div><dt>Issuer</dt><dd>{doc.issuer}</dd></div>}{doc.reference && <div><dt>Reference</dt><dd>{doc.reference}</dd></div>}</dl>}
              <div className="gdt-document-links"><a href={doc.original || doc.image} target="_blank" rel="noopener noreferrer">Open original<ArrowUpRight size={16}/></a>{doc.verificationUrl && <a href={doc.verificationUrl} target="_blank" rel="noopener noreferrer">Issuer record<ArrowUpRight size={16}/></a>}</div>
            </> : <p className="gdt-document-status"><span aria-hidden="true"/>Awaiting document publication</p>}
          </div>
        </article>;
      })}
    </div>
    <dialog ref={viewer} className="gdt-document-viewer" aria-labelledby="document-viewer-title" onCancel={() => setSelected(null)} onClose={() => setSelected(null)} onClick={event => {if (event.target === event.currentTarget) setSelected(null);}}>
      {selected?.document && <>
        <div className="gdt-document-viewer-top"><h3 id="document-viewer-title">{selected.title}</h3><button type="button" autoFocus aria-label="Close document" onClick={() => setSelected(null)}><X size={22}/></button></div>
        {failedImages.includes(selected.id) ? <p>Preview unavailable. Open the original document below.</p> : <img src={selected.document.image} alt={selected.document.imageAlt} onError={() => imageFailed(selected.id)}/>}
        <a className="gdt-document-original" href={selected.document.original || selected.document.image} target="_blank" rel="noopener noreferrer">Open original file<ArrowUpRight size={16}/></a>
      </>}
    </dialog>
  </section>;
}
