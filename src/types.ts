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
  | "inventory:bom"
  | "inventory:raw-materials"
  | "inventory:manufactured"
  | "sales:entry"
  | "dispatch:manage"
  | "accounts:manage"
  | "complaints:consumer"
  | "complaints:supplier"
  | "pricing:manage";

export type JwtPayload = {
  userId: string;
  email: string;
  /** Canonical role name (normalized). */
  role: RoleName;
};

/** `req.user` after authentication (JWT + resolved permissions). */
export type AuthUser = JwtPayload & { permissions: Permission[]; name?: string };

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
  assignedStates?: string[];
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

export type EngineerRole = "L1" | "L2" | "L3" | "Backup";

export type EngineerMaster = {
  id: string;
  name: string;
  email?: string;
  mobile?: string;
  role: EngineerRole;
  isActive?: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type EngineerAssignment = {
  id: string;
  state: string;
  district: string;
  l1EngineerId: string;
  l2EngineerId: string;
  l1BackupEngineerId: string;
  source?: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  updatedBy?: string;
};

export type TicketLoad = {
  id: string;
  engineerId: string;
  activeCount: number;
  waitingCount: number;
  totalCount: number;
  lastUpdated: Date;
  updatedAt: Date;
};

export type EngineerAssignmentAudit = {
  id: string;
  assignmentId: string;
  action: "created" | "updated" | "deleted" | "imported";
  state?: string;
  district?: string;
  before?: Partial<EngineerAssignment>;
  after?: Partial<EngineerAssignment>;
  note?: string;
  by?: string;
  byName?: string;
  createdAt: Date;
};

export type TicketAssignmentLog = {
  id: string;
  ticketId: string;
  customerName: string;
  mobileNumber: string;
  email?: string;
  state: string;
  district: string;
  assignedEngineerId: string;
  assignedEngineerName: string;
  assignmentType: "Primary L1" | "Backup L1" | "L2 Escalation";
  assignmentReason: string;
  assignedAt: Date;
  createdBy?: string;
  lastUpdatedBy?: string;
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

export type InspectionAttachment = {
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
  productDescription?: string;
  modelDescription?: string;
  hsnSac?: string;
  gstRate?: number;
  dealerPrice?: number;
  distributorPrice?: number;
  createdAt: Date;
};

/** Any Indian state/UT name — no longer restricted to the original six, so admins can add new states from the Price Input Module. */
export type PriceStateName = string;

export type PriceStatePoint = {
  distributor: number;
  dealer: number;
  msp: number;
};

export type PriceEntry = {
  id: string;
  srNo?: number;
  description: string;
  modelNo: string;
  modelKey: string;
  prices: Record<PriceStateName, PriceStatePoint>;
  createdAt: Date;
  updatedAt: Date;
};

export type BOMItem = {
  materialName: string;
  quantity: number;
};

export type SeriesBOM = {
  id: string;
  series: string;
  items: BOMItem[];
  createdAt: Date;
  updatedAt: Date;
};

export type InwardMode = "Local" | "International";

export type InwardMaster = {
  id: string;
  inwardNo: string;
  inwardMode: InwardMode;
  batch: string;
  vendorName: string;
  dateReceived: Date;
  billType: string;
  referenceNo: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
};

export type InwardItemDetail = {
  id: string;
  inwardId: string;
  productSeriesId: string;
  materialName: string;
  quantityReceived: number;
  createdAt: Date;
};

export type Counter = {
  id: string;
  seq: number;
};

export type RawMaterial = {
  id: string;
  productSeriesId: string;
  inwardMode?: "Local" | "International";
  materialName: string;
  dateReceived: Date;
  billType: string;
  referenceNo: string;
  quantityReceived: number;
  quantityAvailable: number;
  vendorName: string;
  batch: string;
  notes?: string;
  inwardId?: string;
  returnStatus?: "Not Returned" | "Returned to Vendor" | "Replaced in Production";
  returnedQuantity?: number;
  returnReason?: string;
  returnedAt?: Date;
  returnedBy?: string;
  returnedByName?: string;
  faultyQuantity?: number;
  repairedQuantity?: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ManufacturedStatus = "In Stock" | "Sold" | "Returned" | "Failed" | "Faulty" | "Repaired";
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
    inwardMode?: "Local" | "International";
    invoiceNo?: string;
    vendorName?: string;
    quantityUsed: number;
  }[];
  customerId?: string;
  customerPhones?: string[];
  soldDate?: Date;
  returnReason?: string;
  returnedAt?: Date;
  returnedBy?: string;
  returnedByName?: string;
  replacedWithSerial?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type SerialStatus = "Available" | "Manufactured" | "Dispatched" | "Sold" | "Replacement Claimed" | "Used";
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
  vehicleNo?: string;
  documentType: string;
  referenceNo: string;
  saleDate: Date;
  customerId?: string;
  customerName?: string;
  dealerName?: string;
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
    serialNumbers?: string[];
  }[];
  stateRegion?: string;
  dealerRegistered?: boolean;
  rjApprovalStatus?: "Not Required" | "Pending" | "Approved";
  forcePiPermission?: boolean;
  priceCategory?: "Dealer Price" | "Distributor Price" | "MSP" | "Manual";
  availableQuantity?: number;
  inventoryStatus?: "Available" | "Insufficient";
  forcePiApprovalStatus?: "Not Required" | "Pending" | "Approved";
  forcePiApprovedBy?: string;
  forcePiApprovedAt?: Date;
  piAttachmentName?: string;
  piAttachmentUrl?: string;
  expectedDispatchDate?: Date;
  confirmedDispatchDate?: Date;
  dispatchStatus?: "Planned" | "Ready" | "Final Dispatch" | "Delivered" | "Dispatched";
  courierDocketNo?: string;
  courierDocketAttachmentName?: string;
  courierDocketAttachmentUrl?: string;
  taxInvoiceAttachmentName?: string;
  taxInvoiceAttachmentUrl?: string;
  ewayBillAttachmentName?: string;
  ewayBillAttachmentUrl?: string;
  accountsRequestAt?: Date;
  accountsRequestBy?: string;
  accountsSharedAt?: Date;
  accountsSharedBy?: string;
  paymentStatus?: "Pending" | "Confirmed";
  paymentVerifiedAt?: Date;
  paymentVerifiedBy?: string;
  dispatchReadyAt?: Date;
  dispatchReadyBy?: string;
  finalDispatchAt?: Date;
  finalDispatchBy?: string;
  piWorkflowVersion?: "payment-dispatch-v2" | string;
  piWorkflowStatus?:
    | "PI Submitted - Pending Payment Verification"
    | "Payment Verified - Pending Dispatch Preparation"
    | "Dispatch Ready - Pending Invoice & E-Way Bill"
    | "Ready for Final Dispatch"
    | "Dispatched"
    | string;
  piWorkflowHistory?: {
    id: string;
    action: string;
    fromStatus?: string;
    toStatus: string;
    department: "Sales" | "Accounts" | "Dispatch" | string;
    by: string;
    byName?: string;
    byRole?: string;
    at: Date;
    note?: string;
  }[];
  createdBy: string;
  createdAt: Date;
};

export type ComplaintType = "Consumer" | "Supplier" | string;
export type ComplaintStatus =
  | "Open at Aurawatt"
  | "Waiting Lobby"
  | "Assigned to Engineer"
  | "Assigned for Onsite"
  | "In Progress at Aurawatt"
  | "Escalated to L2"
  | "Escalated to L3"
  | "Pending L3 Approval"
  | "Spare Requested"
  | "Replacement Requested"
  | "Awaiting Dispatch"
  | "Dispatch in Progress"
  | "On Hold"
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
  inverterPictures?: InspectionAttachment[];
};

export type OnsiteInspection = {
  inverterModel?: string;
  serialNumber?: string;
  errorCode?: string;
  eTotalKwh?: number;
  physicalChecks?: Record<string, boolean>;
  acReadings?: Record<string, number | undefined>;
  dcReadings?: Record<string, number | undefined>;
  batteryReadings?: Record<string, number | boolean | undefined>;
  systemStatus?: Record<string, boolean>;
  observationNotes?: string;
  inverterPictures?: InspectionAttachment[];
};

export type ComplaintProgressUpdate = {
  id: string;
  date: Date;
  note: string;
  byName?: string;
  byRole?: string;
  createdAt: Date;
};

export type ComplaintWorkflowEvent = {
  id: string;
  action: string;
  fromStatus?: string;
  toStatus: string;
  by: string;
  byName?: string;
  byRole?: string;
  at: Date;
  note?: string;
};

export type SparePartRequirement = {
  id: string;
  name: string;
  quantity: number;
  notes?: string;
};

export type SpareRequestPart = {
  id: string;
  series?: string;
  rawMaterialId?: string;
  materialName: string;
  availableQuantity?: number;
  quantity: number;
  notes?: string;
};

export type Complaint = {
  id: string;
  ticketNumber?: string;
  type: ComplaintType;
  productSerialNo?: string;
  productSerialNoKey?: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  customerPhones?: string[];
  customerEmail?: string;
  rawMaterialId?: string;
  rawMaterialName?: string;
  vendorName?: string;
  dateOfSale?: Date;
  installationDate?: Date;
  dateOfComplaint: Date;
  issueDescription: string;
  ticketSource?: "Call" | "WhatsApp" | "Link" | "ERP";
  l1Sla?: "2 Hours" | "4 Hours";
  dealerName?: string;
  siteLocation?: string;
  state?: string;
  district?: string;
  region?: string;
  priority?: ServicePriority;
  warrantyStatus?: "In Warranty" | "Out of Warranty" | "Unknown" | string;
  productModel?: string;
  customerReportedPictures?: InspectionAttachment[];
  taxInvoiceNo?: string;
  taxInvoiceDate?: Date;
  assignmentStatus?: "Assigned" | "Waiting";
  assignedEngineerId?: string;
  assignedEngineerName?: string;
  backupEngineerName?: string;
  assignmentType?: "Primary L1" | "Backup L1" | "L2 Escalation";
  overflowFromEngineerId?: string;
  overflowFromEngineerName?: string;
  activeTicketCountAtAssignment?: number;
  escalatedById?: string;
  escalatedByName?: string;
  escalatedByRole?: string;
  escalatedAt?: Date;
  escalationReason?: string;
  escalationNotes?: string;
  waitingSince?: Date;
  slaStartedAt?: Date;
  slaDueAt?: Date;
  slaPaused?: boolean;
  holdReason?: string;
  heldAt?: Date;
  heldById?: string;
  heldByName?: string;
  statusBeforeHold?: ComplaintStatus;
  /** SLA time left when the ticket went on hold, so resuming stays fair. */
  slaRemainingMsAtHold?: number;
  queuePosition?: number;
  initialAction?: string;
  trackingNotes?: string;
  escalationLevel?: "L1" | "L2" | "L3";
  l1Inspection?: L1Inspection;
  l1InspectionValid?: boolean;
  onsiteInspection?: OnsiteInspection;
  serviceStartedAt?: Date;
  progressUpdates?: ComplaintProgressUpdate[];
  technicalDiagnosis?: string;
  spareRequired?: boolean;
  spareName?: string;
  spareQuantity?: number;
  spareDispatchAddress?: string;
  spareParts?: SpareRequestPart[];
  spareInventoryStatus?: "Not Required" | "Available" | "Procurement Required";
  spareRequestStatus?: "Not Required" | "Requested" | "Reserved" | "Dispatched" | "Procurement Triggered" | string;
  dispatchTrackingNo?: string;
  dispatchLrCopyName?: string;
  dispatchLrCopyUrl?: string;
  procurementStatus?: "Not Required" | "Vendor Triggered" | "Approval Pending" | "Processing" | "Received" | string;
  chargeableApprovalStatus?: "Not Required" | "Pending" | "Approved" | "Rejected" | string;
  paymentVerificationStatus?: "Pending" | "Verified" | string;
  replacementApprovalStatus?: "Not Required" | "Pending Accounts" | "Approved" | "Rejected" | string;
  replacementRecommended?: boolean;
  replacementSeriesName?: string;
  replacementModelName?: string;
  replacementProductName?: string;
  replacementProductNo?: string;
  replacementRequestSerialNo?: string;
  faultyReturnStatus?: "Not Required" | "Pending" | "Received";
  faultyReturnNotes?: string;
  faultyReturnType?: "Inverter" | "Spare Part";
  faultyReturnItemId?: string;
  replacementSerialNo?: string;
  replacementEngineerId?: string;
  replacementEngineerName?: string;
  dispatchPlan?: string;
  siteVisitRequired?: boolean;
  siteVisitEngineerId?: string;
  siteVisitEngineerName?: string;
  siteVisitRequestedById?: string;
  siteVisitRequestedByName?: string;
  siteVisitRequestedByRole?: string;
  siteVisitRequestedAt?: Date;
  siteVisitAcceptedAt?: Date;
  siteVisitRemarks?: string;
  siteVisitSpareParts?: SparePartRequirement[];
  siteVisitScheduledDate?: Date;
  siteVisitAssignedById?: string;
  siteVisitAssignedByName?: string;
  siteVisitAssignedByRole?: string;
  siteVisitCompletedAt?: Date;
  engineerName?: string;
  l3SupportRequired?: boolean;
  replacementReason?: string;
  replacementRemarks?: string;
  replacementRequestImages?: InspectionAttachment[];
  replacementRequestedById?: string;
  replacementRequestedByName?: string;
  replacementRequestedByRole?: string;
  replacementRequestedAt?: Date;
  replacementApprovedById?: string;
  replacementApprovedByName?: string;
  replacementApprovedByRole?: string;
  replacementApprovedAt?: Date;
  finalResolution?: string;
  clientFeedback?: string;
  closureReport?: string;
  closeRemark?: string;
  closedByName?: string;
  closedByRole?: string;
  closedAt?: Date;
  status: ComplaintStatus;
  raisedBy: string;
  createdAt: Date;
  updatedAt: Date;
  workflowHistory?: ComplaintWorkflowEvent[];
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
  | "complaint_workflow_updated"
  | "complaint_completed"
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

export type InventoryLogType = "Intake" | "Manufacturing" | "Spare Dispatch" | "Sales Dispatch" | "Replacement Dispatch";

export type InventoryLog = {
  id: string;
  type: InventoryLogType;
  itemId: string; // ID of the raw material or product
  itemName: string;
  quantityChange: number; // positive for intake, negative for dispatch/manufacturing
  referenceId?: string; // Manufactured ID, SO ID, Ticket ID, etc.
  notes?: string;
  createdAt: Date;
  createdBy: string;
};

export type SpareRequestStatus = "Pending" | "Approved" | "Dispatched" | "Rejected";

export type SpareRequest = {
  id: string;
  ticketId: string;
  complaintId: string;
  rawMaterialId: string;
  materialName: string;
  quantity: number;
  reason?: string;
  status: SpareRequestStatus;
  requestedBy: string;
  requestedAt: Date;
  approvedBy?: string;
  approvedAt?: Date;
  dispatchedBy?: string;
  dispatchedAt?: Date;
  courierDetails?: string;
};

export type ReplacementRequestStatus = "Pending" | "Approved" | "Dispatched" | "Rejected";

export type ReplacementRequest = {
  id: string;
  ticketId: string;
  complaintId: string;
  oldSerialNo: string;
  newSerialNo?: string;
  model: string;
  series: string;
  reason?: string;
  status: ReplacementRequestStatus;
  requestedBy: string;
  requestedAt: Date;
  approvedBy?: string;
  approvedAt?: Date;
  dispatchedBy?: string;
  dispatchedAt?: Date;
  courierDetails?: string;
};


export type SupportVideoLanguage = "hindi" | "english";

export type SupportVideo = {
  id: string;
  language: SupportVideoLanguage;
  url: string;
  publicId?: string;
  format?: string;
  durationSeconds?: number;
  bytes?: number;
  originalFileName?: string;
  title?: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
};
