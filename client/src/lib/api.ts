export type UserRole = "TEACHER" | "STUDENT";

export type AuthUser = {
  id: string;
  username: string;
  role: UserRole;
  fullName: string;
  mustChangePassword: boolean;
};

export type TeacherDashboard = {
  role: "TEACHER";
  summary: {
    students: number;
    classes: number;
    modules: number;
    assignments: number;
    completedStudents: number;
    incompleteStudents: number;
    attendanceRate: number;
  };
  gradeTrend: { month: string; averageScore: number }[];
  recentActivities: { id: string; type: string; name: string; at: string }[];
};

export type StudentDashboard = {
  role: "STUDENT";
  summary: {
    classes: number;
    progress: number;
    outstandingAssignments: number;
    attendanceRate: number;
  };
  classes: {
    id: string;
    name: string;
    subject: string;
    teacher: string;
    progress: number;
  }[];
  dueAssignments: {
    id: string;
    title: string;
    className: string;
    dueAt: string;
  }[];
  latestGrades: {
    id: string;
    title: string;
    score: number;
    maxScore: number;
    gradedAt: string;
  }[];
  recentActivities: { id: string; type: string; at: string }[];
};

export type LearningClass = {
  id: string;
  name: string;
  subject: string;
  academicYear: string;
  semester: "ODD" | "EVEN";
  description: string | null;
  studentCount: number;
  moduleCount: number;
  assignmentCount: number;
  assessmentCount: number;
};

export type ClassStudent = {
  id: string;
  nisn: string;
  fullName: string;
  requiredModules: number;
  completedModules: number;
  progress: number;
  completed: boolean;
};

export type ModuleContentType =
  | "TEXT"
  | "PDF"
  | "DOCX"
  | "IMAGE"
  | "VIDEO"
  | "LINK"
  | "YOUTUBE"
  | "GAME";

export type ModuleContent = {
  id: string;
  title: string;
  description: string | null;
  contentType: ModuleContentType;
  body: string | null;
  externalUrl: string | null;
  position: number;
  durationMinutes: number | null;
  isRequired: boolean;
  completed?: boolean;
  fileUrl?: string | null;
  startedAt?: string | null;
  gameId?: string | null;
};

export type LearningModule = {
  id: string;
  title: string;
  description: string | null;
  learningObjectives: string | null;
  position: number;
  durationMinutes: number | null;
  isRequired: boolean;
  contents?: ModuleContent[];
  requiredCount?: number;
  completedCount?: number;
  progress?: number;
  completed?: boolean;
  unlocked?: boolean;
  status?: "LOCKED" | "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const errorBody =
      typeof body === "object" && body !== null
        ? (body as { error?: unknown; code?: unknown })
        : {};
    throw new ApiError(
      typeof errorBody.error === "string"
        ? errorBody.error
        : "Permintaan tidak dapat diproses.",
      response.status,
      typeof errorBody.code === "string" ? errorBody.code : undefined,
    );
  }

  return body as T;
}
