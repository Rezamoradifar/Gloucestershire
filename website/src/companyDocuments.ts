export type PublishedCompanyDocument = {
  image: string;
  imageAlt: string;
  original?: string;
  issuer?: string;
  reference?: string;
  verificationUrl?: string;
};

export type CompanyDocument = {
  id: string;
  title: string;
  label: string;
  sampleImage?: {src: string; alt: string};
  document: PublishedCompanyDocument | null;
};

// Add the operator's supplied documents here. Null means no document is published;
// it does not imply registration, authorisation or a pending licence application.
export const companyDocuments: CompanyDocument[] = [
  {id: 'company-registration', title: 'Company registration', label: 'CORPORATE RECORD', sampleImage: {src: '/assets/company-registration-sample.webp', alt: 'Illustrative corporate building; not a photograph of the registered company or a registration document'}, document: null},
  {id: 'operating-licence', title: 'Operating licence', label: 'OPERATING DOCUMENT', sampleImage: {src: '/assets/operating-documents-sample.webp', alt: 'Illustrative portfolio with blank stationery; not an operating licence'}, document: null},
];
