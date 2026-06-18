export type SeedEngineerRole = "L1" | "L2" | "L3" | "Backup";

export type SeedEngineerMaster = {
  id: string;
  name: string;
  email: string;
  mobile: string;
  role: SeedEngineerRole;
};

export type SeedEngineerAssignment = {
  state: string;
  district: string;
  l1EngineerName: string;
  l2EngineerName: string;
  l1BackupEngineerName: string;
};

export const SEED_ENGINEER_MASTER_ROWS: SeedEngineerMaster[] = [
  { id: "eng-l1-ashutosh", name: "Ashutosh", email: "", mobile: "", role: "L1" },
  { id: "eng-l1-neeraj", name: "Neeraj", email: "", mobile: "", role: "L1" },
  { id: "eng-l1-nitin", name: "Nitin", email: "", mobile: "", role: "L1" },
  { id: "eng-l1-pending", name: "Pending", email: "", mobile: "", role: "L1" },
  { id: "eng-l1-pradeep", name: "Pradeep", email: "", mobile: "", role: "L1" },
  { id: "eng-l1-prashant-singh", name: "Prashant Singh", email: "", mobile: "", role: "L1" },
  { id: "eng-l1-piyush", name: "Piyush", email: "", mobile: "", role: "L1" },
  { id: "eng-l1-rajat", name: "Rajat", email: "", mobile: "", role: "L1" },
  { id: "eng-l1-swastik", name: "Swastik", email: "", mobile: "", role: "L1" },
  { id: "eng-l2-naveen-maurya", name: "Naveen Maurya", email: "", mobile: "", role: "L2" },
  { id: "eng-l2-prashant-noida", name: "Prashant Noida", email: "", mobile: "", role: "L2" },
  { id: "eng-l3-mahesh-choudhary", name: "Mahesh Choudhary", email: "", mobile: "", role: "L3" },
  { id: "eng-backup-ashutosh", name: "Ashutosh Backup", email: "", mobile: "", role: "Backup" },
  { id: "eng-backup-neeraj", name: "Neeraj Backup", email: "", mobile: "", role: "Backup" },
  { id: "eng-backup-nitin", name: "Nitin Backup", email: "", mobile: "", role: "Backup" },
  { id: "eng-backup-pradeep", name: "Pradeep Backup", email: "", mobile: "", role: "Backup" },
  { id: "eng-backup-prashant-singh", name: "Prashant Singh Backup", email: "", mobile: "", role: "Backup" },
  { id: "eng-backup-piyush", name: "Piyush Backup", email: "", mobile: "", role: "Backup" },
  { id: "eng-backup-rajat", name: "Rajat Backup", email: "", mobile: "", role: "Backup" },
  { id: "eng-backup-swastik", name: "Swastik Backup", email: "", mobile: "", role: "Backup" },
  { id: "eng-backup-naveen-maurya", name: "Naveen Maurya", email: "", mobile: "", role: "Backup" },
  { id: "eng-backup-prashant-noida", name: "Prashant Noida", email: "", mobile: "", role: "Backup" },
];

export const SEED_ENGINEER_ASSIGNMENT_ROWS: SeedEngineerAssignment[] = [
  { state: "Uttar Pradesh", district: "Bulandshahr", l1EngineerName: "Piyush", l2EngineerName: "Prashant Noida", l1BackupEngineerName: "Prashant Noida" },
  { state: "Uttar Pradesh", district: "Lucknow", l1EngineerName: "Neeraj", l2EngineerName: "Naveen Maurya", l1BackupEngineerName: "Naveen Maurya" },
  { state: "Haryana", district: "Charkhi Dadri", l1EngineerName: "Nitin", l2EngineerName: "Prashant Noida", l1BackupEngineerName: "Prashant Noida" },
  { state: "Uttar Pradesh", district: "Ayodhya", l1EngineerName: "Neeraj", l2EngineerName: "Naveen Maurya", l1BackupEngineerName: "Naveen Maurya" },
  { state: "Uttar Pradesh", district: "Prayagraj", l1EngineerName: "Prashant Singh", l2EngineerName: "Naveen Maurya", l1BackupEngineerName: "Naveen Maurya" },
  { state: "Uttar Pradesh", district: "Gonda", l1EngineerName: "Neeraj", l2EngineerName: "Naveen Maurya", l1BackupEngineerName: "Naveen Maurya" },
  { state: "Uttar Pradesh", district: "Ghazipur", l1EngineerName: "Ashutosh", l2EngineerName: "Naveen Maurya", l1BackupEngineerName: "Naveen Maurya" },
  { state: "Uttar Pradesh", district: "Mirzapur", l1EngineerName: "Prashant Singh", l2EngineerName: "Naveen Maurya", l1BackupEngineerName: "Naveen Maurya" },
  { state: "Haryana", district: "Faridabad", l1EngineerName: "Piyush", l2EngineerName: "Prashant Noida", l1BackupEngineerName: "Prashant Noida" },
  { state: "Uttarakhand", district: "Shahranpur", l1EngineerName: "Pending", l2EngineerName: "Prashant Noida", l1BackupEngineerName: "Prashant Noida" },
  { state: "Haryana", district: "Hisar", l1EngineerName: "Nitin", l2EngineerName: "Prashant Noida", l1BackupEngineerName: "Prashant Noida" },
  { state: "Uttar Pradesh", district: "Mathura", l1EngineerName: "Piyush", l2EngineerName: "Prashant Noida", l1BackupEngineerName: "Prashant Noida" },
  { state: "Uttar Pradesh", district: "Varanasi", l1EngineerName: "Swastik", l2EngineerName: "Naveen Maurya", l1BackupEngineerName: "Naveen Maurya" },
  { state: "Uttar Pradesh", district: "Bareilly", l1EngineerName: "Rajat", l2EngineerName: "Naveen Maurya", l1BackupEngineerName: "Naveen Maurya" },
  { state: "Rajasthan", district: "Sri Ganganagar", l1EngineerName: "Nitin", l2EngineerName: "Prashant Noida", l1BackupEngineerName: "Prashant Noida" },
  { state: "Uttarakhand", district: "Dehradun", l1EngineerName: "Pending", l2EngineerName: "Prashant Noida", l1BackupEngineerName: "Prashant Noida" },
  { state: "Uttar Pradesh", district: "Ghaziabad", l1EngineerName: "Piyush", l2EngineerName: "Prashant Noida", l1BackupEngineerName: "Prashant Noida" },
  { state: "Uttar Pradesh", district: "Firozabad", l1EngineerName: "Neeraj", l2EngineerName: "Naveen Maurya", l1BackupEngineerName: "Naveen Maurya" },
  { state: "Uttar Pradesh", district: "Meerut", l1EngineerName: "Piyush", l2EngineerName: "Prashant Noida", l1BackupEngineerName: "Prashant Noida" },
  { state: "Uttar Pradesh", district: "Jhansi", l1EngineerName: "Pradeep", l2EngineerName: "Naveen Maurya", l1BackupEngineerName: "Naveen Maurya" },
  { state: "Uttar Pradesh", district: "Bahraich", l1EngineerName: "Neeraj", l2EngineerName: "Naveen Maurya", l1BackupEngineerName: "Naveen Maurya" },
  { state: "Punjab", district: "Mohali", l1EngineerName: "Nitin", l2EngineerName: "Prashant Noida", l1BackupEngineerName: "Prashant Noida" },
  { state: "Haryana", district: "Bahadurgarh", l1EngineerName: "Piyush", l2EngineerName: "Prashant Noida", l1BackupEngineerName: "Prashant Noida" },
  { state: "Delhi", district: "Delhi", l1EngineerName: "Piyush", l2EngineerName: "Prashant Noida", l1BackupEngineerName: "Prashant Noida" },
  { state: "Haryana", district: "Bhiwani", l1EngineerName: "Nitin", l2EngineerName: "Prashant Noida", l1BackupEngineerName: "Prashant Noida" },
];
