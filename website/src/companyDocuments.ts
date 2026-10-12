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
  document: PublishedCompanyDocument | null;
};

// Add the operator's supplied documents here. Null means no document is published;
// it does not imply registration, authorisation or a pending licence application.
export const companyDocuments: CompanyDocument[] = [
  {id: 'company-registration', title: 'Company registration', label: 'CORPORATE RECORD', document: null},
  {id: 'operating-licence', title: 'Operating licence', label: 'OPERATING DOCUMENT', document: null},
];
