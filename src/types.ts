export type SystemRoleName =
  | "Admin"
  | "Inventory"
  | "Sales"
  | "Dispatch"
  | "Accounts"
  | "Distributor"
  | "L1 Engineer"
  | "L2 Technical Team"
  | "L3 Advanced OEM Support"
  | "Warehouse Team"
  | "Accounts Team"
  | "Dealer";
export type RoleName = string;
/** Stored user role (may include legacy or custom role names). */
export type UserRole = string;

export type Permission =
  | "dashboard:view"
  | "users:manage"
  | "roles:manage"
  | "customers:manage"
  | "distributors:manage"
  | "inventory:serials"
  | "inventory:products"
  | "inventory:raw-materials"
  | "inventory:manufactured"
  | "sales:entry"
  | "dispatch:manage"
  | "accounts:manage"
  | "complaints:consumer"
  | "complaints:supplier";

export type JwtPayload = {
  userId: string;
  email: string;
  /** Canonical role name (normalized). */
  role: RoleName;
};

/** `req.user` after authentication (JWT + resolved permissions). */
export type AuthUser = JwtPayload & { permissions: Permission[] };

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

export type PendingCustomerRegistration = {
  id: string;
  name: string;
  type: CustomerType;
  email?: string;
  phone: string;
  address?: string;
  stateRegion?: string;
  registrationCode?: string;
  dateOfRegistration?: Date;
  gst?: string;
  cinNo?: string;
  pan?: string;
  tan?: string;
  contactPersonName?: string;
  billingAddress?: string;
  deliveryAddress1?: string;
  deliveryAddress2?: string;
  deliveryAddress3?: string;
  areaAllotted?: string;
  distributorshipType?: string;
  documentsUploaded?: CustomerDocument[];
  relevantSalesPerson?: string;
  status: "Pending" | "Approved";
  requestedBy: string;
  submittedAt: Date;
  approvedBy?: string;
  approvedAt?: Date;
  customerId?: string;
};

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

export type Role = {
  id: string;
  name: RoleName;
  permissions: Permission[];
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type CustomerType = "Distributor" | "Individual";
export type CustomerStatus = "Active" | "Inactive";
export type CustomerDocument = {
  id: string;
  label: string;
  fileName: string;
  fileType?: string;
  fileSize?: number;
  url: string;
  publicId?: string;
  resourceType?: string;
  format?: string;
  uploadedAt: Date;
};
export type Customer = {
  id: string;
  name: string;
  type: CustomerType;
  email?: string;
  phone: string;
  registrationCode?: string;
  address?: string;
  stateRegion?: string;
  dateOfRegistration?: Date;
  gst?: string;
  cinNo?: string;
  pan?: string;
  tan?: string;
  contactPersonName?: string;
  billingAddress?: string;
  deliveryAddress1?: string;
  deliveryAddress2?: string;
  deliveryAddress3?: string;
  areaAllotted?: string;
  distributorshipType?: string;
  documentsUploaded?: CustomerDocument[];
  relevantSalesPerson?: string;
  status: CustomerStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type Product = {
  id: string;
  series: string;
  model: string;
  description?: string;
  hsnSac?: string;
  gstRate?: number;
  dealerPrice?: number;
  distributorPrice?: number;
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
  bomUsage?: {
    rawMaterialId?: string;
    materialName: string;
    batch?: string;
    invoiceNo?: string;
    vendorName?: string;
    quantityUsed: number;
  }[];
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
  importFileName?: string;
  importFileUrl?: string;
  importFilePublicId?: string;
  uploadedAt: Date;
};

export type Sale = {
  id: string;
  serialNumber?: string;
  documentType: string;
  referenceNo: string;
  saleDate: Date;
  customerId?: string;
  unregisteredCustomerName?: string;
  unregisteredCustomerAddress?: string;
  unregisteredCustomerGst?: string;
  shipToAddressKey?: "address" | "billingAddress" | "deliveryAddress1" | "deliveryAddress2" | "deliveryAddress3";
  registrationCode?: string;
  materialName?: string;
  quantity?: number;
  piItems?: {
    materialName: string;
    hsnSac?: string;
    quantity: number;
    rate: number;
    gstRate: number;
  }[];
  stateRegion?: string;
  dealerRegistered?: boolean;
  rjApprovalStatus?: "Not Required" | "Pending" | "Approved";
  forcePiPermission?: boolean;
  priceCategory?: "Dealer Price" | "Distributor Price";
  availableQuantity?: number;
  inventoryStatus?: "Available" | "Insufficient";
  forcePiApprovalStatus?: "Not Required" | "Pending" | "Approved";
  forcePiApprovedBy?: string;
  forcePiApprovedAt?: Date;
  piAttachmentName?: string;
  piAttachmentUrl?: string;
  expectedDispatchDate?: Date;
  confirmedDispatchDate?: Date;
  dispatchStatus?: "Planned" | "Ready" | "Final Dispatch" | "Delivered";
  courierDocketNo?: string;
  courierDocketAttachmentName?: string;
  courierDocketAttachmentUrl?: string;
  taxInvoiceAttachmentName?: string;
  taxInvoiceAttachmentUrl?: string;
  ewayBillAttachmentName?: string;
  ewayBillAttachmentUrl?: string;
  accountsSharedAt?: Date;
  accountsSharedBy?: string;
  paymentStatus?: "Pending" | "Confirmed";
  createdBy: string;
  createdAt: Date;
};

export type ComplaintType = "Consumer" | "Supplier" | string;
export type ComplaintStatus =
  | "Open at Aurawatt"
  | "Waiting Lobby"
  | "Assigned to Engineer"
  | "In Progress at Aurawatt"
  | "Escalated to L2"
  | "Escalated to L3"
  | "Spare Requested"
  | "Dispatch in Progress"
  | "Resolved by Aurawatt"
  | "Pending with Suppliers"
  | "Resolved by Suppliers"
  | string;

export type ServicePriority = "Low" | "Medium" | "High" | "Emergency";

export type L1Inspection = {
  inverterModel?: string;
  serialNumber?: string;
  errorCode?: string;
  eTotalKwh?: number;
  physicalChecks?: Record<string, boolean>;
  acReadings?: Record<string, number | undefined>;
  dcReadings?: Record<string, number | undefined>;
  batteryReadings?: Record<string, number | boolean | undefined>;
  systemStatus?: Record<string, boolean>;
  errorFrequency?: "Once" | "Intermittent" | "Repeated" | "Continuous" | string;
  repeatIssue?: boolean;
  systemShutdown?: boolean;
  faultType?: "Temporary" | "Permanent" | string;
  observationNotes?: string;
  remoteResolutionPossible?: boolean;
  siteVisitRequiredSuspected?: boolean;
  spareSuspected?: boolean;
  escalateToL2?: boolean;
};

export type Complaint = {
  id: string;
  type: ComplaintType;
  productSerialNo?: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  rawMaterialId?: string;
  rawMaterialName?: string;
  vendorName?: string;
  dateOfSale?: Date;
  dateOfComplaint: Date;
  issueDescription: string;
  ticketSource?: "Call" | "WhatsApp" | "Link" | "ERP";
  l1Sla?: "2 Hours" | "4 Hours";
  dealerName?: string;
  siteLocation?: string;
  region?: string;
  priority?: ServicePriority;
  warrantyStatus?: "In Warranty" | "Out of Warranty" | "Unknown" | string;
  productModel?: string;
  assignmentStatus?: "Assigned" | "Waiting";
  assignedEngineerId?: string;
  assignedEngineerName?: string;
  backupEngineerName?: string;
  activeTicketCountAtAssignment?: number;
  waitingSince?: Date;
  slaStartedAt?: Date;
  slaDueAt?: Date;
  slaPaused?: boolean;
  queuePosition?: number;
  initialAction?: string;
  trackingNotes?: string;
  escalationLevel?: "L1" | "L2" | "L3";
  l1Inspection?: L1Inspection;
  l1InspectionValid?: boolean;
  technicalDiagnosis?: string;
  spareRequired?: boolean;
  spareName?: string;
  spareInventoryStatus?: "Not Required" | "Available" | "Procurement Required";
  spareRequestStatus?: "Not Required" | "Requested" | "Reserved" | "Dispatched" | "Procurement Triggered" | string;
  dispatchTrackingNo?: string;
  procurementStatus?: "Not Required" | "Vendor Triggered" | "Approval Pending" | "Processing" | "Received" | string;
  chargeableApprovalStatus?: "Not Required" | "Pending" | "Approved" | "Rejected" | string;
  paymentVerificationStatus?: "Pending" | "Verified" | string;
  replacementApprovalStatus?: "Not Required" | "Pending Accounts" | "Approved" | "Rejected" | string;
  dispatchPlan?: string;
  siteVisitRequired?: boolean;
  engineerName?: string;
  l3SupportRequired?: boolean;
  finalResolution?: string;
  clientFeedback?: string;
  closureReport?: string;
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

export type NotificationType =
  | "sale_recorded"
  | "raw_material_received"
  | "manufactured_created"
  | "complaint_created"
  | "customer_registration_requested"
  | "user_registered";

export type Notification = {
  id: string;
  type: NotificationType;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  meta?: Record<string, unknown>;
  /** If omitted, notification is visible to all authenticated users. */
  audienceRoles?: UserRole[];
  /** If set, notification is visible to these users (in addition to roles if provided). */
  audienceUserIds?: string[];
  readBy: string[];
  createdBy: string;
  createdAt: Date;
};
