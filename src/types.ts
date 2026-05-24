export type UserRole = "Admin" | "Inventory Manager" | "Sales Manager" | "Distributor";

export type JwtPayload = {
  userId: string;
  email: string;
  role: UserRole;
};

export type LoginRequest = {
  email: string;
  password: string;
};

export type RegisterRequest = {
  name: string;
  email: string;
  mobile: string;
  role: UserRole;
  password: string;
};

export type PendingRegistration = RegisterRequest & { id: string; submittedAt: Date };

export type User = {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  mobile: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type CustomerType = "Distributor" | "Individual";
export type CustomerStatus = "Active" | "Inactive";
export type Customer = {
  id: string;
  name: string;
  type: CustomerType;
  email: string;
  phone: string;
  address?: string;
  status: CustomerStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type Product = {
  id: string;
  series: string;
  model: string;
  description?: string;
  createdAt: Date;
};

export type RawMaterial = {
  id: string;
  productSeriesId: string;
  materialName: string;
  dateReceived: Date;
  billType: string;
  referenceNo: string;
  quantityReceived: number;
  quantityAvailable: number;
  vendorName: string;
  batch: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ManufacturedStatus = "In Stock" | "Sold" | "Returned";
export type PaymentStatus = "N/A" | "Pending" | "Verified";
export type ManufacturedProduct = {
  id: string;
  productId: string;
  serialNumber: string;
  mfgDate: Date;
  status: ManufacturedStatus;
  invoiceNo?: string;
  paymentStatus: PaymentStatus;
  customerId?: string;
  soldDate?: Date;
  returnReason?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type SerialStatus = "Available" | "Used";
export type SerialEntry = {
  id: string;
  serialNumber: string;
  productSeriesId: string;
  status: SerialStatus;
  uploadedAt: Date;
};

export type Sale = {
  id: string;
  serialNumber: string;
  documentType: string;
  referenceNo: string;
  saleDate: Date;
  customerId: string;
  createdBy: string;
  createdAt: Date;
};

export type ComplaintType = "Consumer" | "Supplier" | string;
export type ComplaintStatus =
  | "Open at Aurawatt"
  | "In Progress at Aurawatt"
  | "Resolved by Aurawatt"
  | "Pending with Suppliers"
  | "Resolved by Suppliers";

export type Complaint = {
  id: string;
  type: ComplaintType;
  productSerialNo?: string;
  rawMaterialId?: string;
  rawMaterialName?: string;
  vendorName?: string;
  dateOfSale?: Date;
  dateOfComplaint: Date;
  issueDescription: string;
  status: ComplaintStatus;
  raisedBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export type Distributor = {
  id: string;
  name: string;
  email: string;
  mobile: string;
  address: string;
  unitsSold: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};
