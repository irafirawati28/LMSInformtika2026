import { Router, type Request, type Response } from "express";
import type { PoolClient, QueryResultRow } from "pg";
import { pool } from "../../db/pool.js";
import { requireStudent } from "../../middleware/require-student.js";
import { requireTeacher } from "../../middleware/require-teacher.js";
import type { AuthenticatedUser } from "../../middleware/require-auth.js";

type GameChoice = { id: string; text: string };
type GameQuestion = {
  id: string;
  prompt: string;
  choices: GameChoice[];
  answerId: string;
};
type GameConfiguration = {
  instructions: string;
  passScore: number;
  externalUrl?: string;
  questions: GameQuestion[];
};
type GameAnswer = { questionId: string; choiceId: string };

const teacherRouter = Router();
const studentRouter = Router();
teacherRouter.use(requireTeacher);
studentRouter.use(requireStudent);

const idFrom = (value: unknown): string | null =>
  typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) ? value : null;

const getUserId = (response: Response): string =>
  (response.locals.authUser as AuthenticatedUser).id;

const parseGameConfiguration = (value: unknown): GameConfiguration | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const instructions = typeof raw.instructions === "string" ? raw.instructions.trim() : "";
  const passScore = typeof raw.passScore === "number" ? raw.passScore : 70;
  let externalUrl: string | undefined;
  if (raw.externalUrl !== undefined && raw.externalUrl !== null && raw.externalUrl !== "") {
    if (typeof raw.externalUrl !== "string" || raw.externalUrl.length > 2048) return null;
    try {
      const url = new URL(raw.externalUrl);
      if (!(["http:", "https:"].includes(url.protocol)) || !url.hostname || url.username || url.password) return null;
      externalUrl = url.toString();
    } catch {
      return null;
    }
  }
  if (
    instructions.length > 2000 ||
    !Number.isInteger(passScore) ||
    passScore < 1 ||
    passScore > 100 ||
    !Array.isArray(raw.questions) ||
    (raw.questions.length < 1 && !externalUrl) ||
    raw.questions.length > 20
  ) return null;

  const ids = new Set<string>();
  const questions: GameQuestion[] = [];
  for (const item of raw.questions) {
    if (!item || typeof item !== "object") return null;
    const question = item as Record<string, unknown>;
    if (
      typeof question.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,40}$/.test(question.id) ||
      ids.has(question.id) ||
      typeof question.prompt !== "string" ||
      question.prompt.trim().length < 3 ||
      question.prompt.trim().length > 1000 ||
      !Array.isArray(question.choices) ||
      question.choices.length < 2 ||
      question.choices.length > 6 ||
      typeof question.answerId !== "string"
    ) return null;

    ids.add(question.id);
    const choiceIds = new Set<string>();
    const choices: GameChoice[] = [];
    for (const entry of question.choices) {
      if (!entry || typeof entry !== "object") return null;
      const choice = entry as Record<string, unknown>;
      if (
        typeof choice.id !== "string" ||
        !/^[a-zA-Z0-9_-]{1,40}$/.test(choice.id) ||
        choiceIds.has(choice.id) ||
        typeof choice.text !== "string" ||
        choice.text.trim().length < 1 ||
        choice.text.trim().length > 500
      ) return null;
      choiceIds.add(choice.id);
      choices.push({ id: choice.id, text: choice.text.trim() });
    }
    if (!choiceIds.has(question.answerId)) return null;
    questions.push({
      id: question.id,
      prompt: question.prompt.trim(),
      choices,
      answerId: question.answerId,
    });
  }
  return { instructions, passScore, ...(externalUrl ? { externalUrl } : {}), questions };
};

const refreshModuleProgress = async (
  client: PoolClient,
  moduleId: string,
): Promise<void> => {
  await client.query(
    `WITH totals AS (
       SELECT p.student_id,
         (
           (SELECT COUNT(*) FROM module_contents mc
            WHERE mc.module_id = p.module_id AND mc.is_active = TRUE AND mc.is_required = TRUE)
           + (SELECT COUNT(*) FROM assignments a
              WHERE a.module_id = p.module_id AND a.is_active = TRUE AND a.is_required = TRUE)
           + (SELECT COUNT(*) FROM assessments a
              WHERE a.module_id = p.module_id AND a.is_active = TRUE AND a.is_required = TRUE)
         )::integer AS required_count,
         (
           (SELECT COUNT(*) FROM module_contents mc
            JOIN student_content_progress scp ON scp.module_content_id = mc.id
              AND scp.student_id = p.student_id AND scp.status = 'COMPLETED'
            WHERE mc.module_id = p.module_id AND mc.is_active = TRUE AND mc.is_required = TRUE)
           + (SELECT COUNT(*) FROM assignments a
              WHERE a.module_id = p.module_id AND a.is_active = TRUE AND a.is_required = TRUE
                AND EXISTS (SELECT 1 FROM assignment_submissions s
                            WHERE s.assignment_id = a.id AND s.student_id = p.student_id))
           + (SELECT COUNT(*) FROM assessments a
              WHERE a.module_id = p.module_id AND a.is_active = TRUE AND a.is_required = TRUE
                AND EXISTS (SELECT 1 FROM assessment_attempts aa
                            WHERE aa.assessment_id = a.id AND aa.student_id = p.student_id
                              AND aa.status IN ('SUBMITTED', 'GRADED')))
         )::integer AS completed_count
       FROM student_module_progress p
       WHERE p.module_id = $1
     )
     UPDATE student_module_progress p
     SET progress_percent = CASE WHEN totals.required_count = 0 THEN 100
                                 ELSE ROUND(totals.completed_count * 100.0 / totals.required_count)::smallint END,
         status = CASE WHEN totals.completed_count = totals.required_count THEN 'COMPLETED' ELSE 'IN_PROGRESS' END,
         completed_at = CASE WHEN totals.completed_count = totals.required_count
                             THEN COALESCE(p.completed_at, CURRENT_TIMESTAMP) ELSE NULL END,
         updated_at = CURRENT_TIMESTAMP
     FROM totals
     WHERE p.module_id = $1 AND p.student_id = totals.student_id`,
    [moduleId],
  );
};

teacherRouter.post("/modules/:moduleId/games", async (request, response) => {
  const moduleId = idFrom(request.params.moduleId);
  const title = typeof request.body?.title === "string" ? request.body.title.trim() : "";
  const description =
    typeof request.body?.description === "string"
      ? request.body.description.trim() || null
      : null;
  const rawDuration = request.body?.durationMinutes;
  const durationMinutes =
    rawDuration === undefined || rawDuration === null || rawDuration === ""
      ? null
      : typeof rawDuration === "number"
        ? rawDuration
        : Number.NaN;
  const configuration = parseGameConfiguration(request.body?.configuration);
  const isRequired = !configuration?.externalUrl && request.body?.isRequired !== false;
  if (
    !moduleId ||
    title.length < 2 ||
    title.length > 180 ||
    (description !== null && description.length > 5000) ||
    (durationMinutes !== null &&
      (!Number.isInteger(durationMinutes) || durationMinutes < 0 || durationMinutes > 1440)) ||
    typeof request.body?.isRequired !== "undefined" &&
      typeof request.body.isRequired !== "boolean" ||
    !configuration
  ) {
    response.status(400).json({ error: "Data game atau soal tidak valid." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const moduleResult = await client.query(
      `SELECT m.id FROM modules m JOIN classes c ON c.id = m.class_id
       WHERE m.id = $1 AND c.teacher_id = $2 AND c.is_active = TRUE AND m.is_active = TRUE
       FOR UPDATE OF m`,
      [moduleId, getUserId(response)],
    );
    if (moduleResult.rowCount !== 1) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Modul tidak ditemukan." });
      return;
    }
    const contentResult = await client.query<QueryResultRow & { id: string }>(
      `INSERT INTO module_contents
         (module_id, title, description, content_type, position, duration_minutes, is_required)
       SELECT $1, $2, $3, 'GAME', COALESCE(MAX(position), 0) + 1, $4, $5
       FROM module_contents WHERE module_id = $1
       RETURNING id`,
      [moduleId, title, description, durationMinutes, isRequired],
    );
    const contentId = contentResult.rows[0]?.id;
    if (!contentId) throw new Error("Database tidak mengembalikan ID game.");
    const gameResult = await client.query<QueryResultRow & { id: string }>(
      `INSERT INTO learning_games (module_content_id, game_type, configuration)
       VALUES ($1, 'MULTIPLE_CHOICE', $2::jsonb)
       RETURNING id`,
      [contentId, JSON.stringify(configuration)],
    );
    if (isRequired) {
      await client.query(
        "INSERT INTO module_requirements (module_id, module_content_id) VALUES ($1, $2)",
        [moduleId, contentId],
      );
    }
    await refreshModuleProgress(client, moduleId);
    await client.query("COMMIT");
    response.status(201).json({ id: contentId, gameId: gameResult.rows[0]?.id });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

teacherRouter.get("/modules/:moduleId/games", async (request, response) => {
  const moduleId = idFrom(request.params.moduleId);
  if (!moduleId) {
    response.status(400).json({ error: "ID modul tidak valid." });
    return;
  }
  const { rows } = await pool.query<QueryResultRow & {
    id: string;
    title: string;
    description: string | null;
    position: number;
    is_required: boolean;
    is_active: boolean;
    game_id: string;
    question_count: number;
    pass_score: number;
    external_url: string | null;
    completed_count: number;
    student_count: number;
  }>(
    `SELECT mc.id, mc.title, mc.description, mc.position, mc.is_required, mc.is_active,
            lg.id AS game_id,
            jsonb_array_length(lg.configuration->'questions') AS question_count,
            (lg.configuration->>'passScore')::integer AS pass_score,
            lg.configuration->>'externalUrl' AS external_url,
            (SELECT COUNT(*)::integer FROM class_students cs
             WHERE cs.class_id = c.id AND cs.is_active = TRUE) AS student_count,
            (SELECT COUNT(DISTINCT attempt.student_id)::integer
             FROM learning_game_attempts attempt
             JOIN class_students cs ON cs.student_id = attempt.student_id
               AND cs.class_id = c.id AND cs.is_active = TRUE
             WHERE attempt.learning_game_id = lg.id AND attempt.passed = TRUE) AS completed_count
     FROM module_contents mc
     JOIN modules m ON m.id = mc.module_id
     JOIN classes c ON c.id = m.class_id
     JOIN learning_games lg ON lg.module_content_id = mc.id AND lg.is_active = TRUE
     WHERE mc.module_id = $1 AND c.teacher_id = $2 AND c.is_active = TRUE
       AND m.is_active = TRUE AND mc.is_active = TRUE
     ORDER BY mc.position`,
    [moduleId, getUserId(response)],
  );
  const { rowCount } = await pool.query(
    `SELECT 1 FROM modules m JOIN classes c ON c.id = m.class_id
     WHERE m.id = $1 AND c.teacher_id = $2 AND c.is_active = TRUE AND m.is_active = TRUE`,
    [moduleId, getUserId(response)],
  );
  if (rowCount !== 1) {
    response.status(404).json({ error: "Modul tidak ditemukan." });
    return;
  }
  response.json({
    games: rows.map((row) => ({
      id: row.id,
      gameId: row.game_id,
      title: row.title,
      description: row.description,
      position: row.position,
      isRequired: row.is_required,
      isActive: row.is_active,
      questionCount: row.question_count,
      passScore: row.pass_score,
      externalUrl: row.external_url,
      completedCount: row.completed_count,
      studentCount: row.student_count,
    })),
  });
});

studentRouter.get("/modules/:moduleId/games", async (request, response) => {
  const moduleId = idFrom(request.params.moduleId);
  if (!moduleId) {
    response.status(400).json({ error: "ID modul tidak valid." });
    return;
  }
  const { rows } = await pool.query<QueryResultRow & {
    id: string;
    title: string;
    description: string | null;
    position: number;
    is_required: boolean;
    game_id: string;
    question_count: number;
    pass_score: number;
    external_url: string | null;
    completed: boolean;
  }>(
    `SELECT mc.id, mc.title, mc.description, mc.position, mc.is_required,
            lg.id AS game_id,
            jsonb_array_length(lg.configuration->'questions') AS question_count,
            (lg.configuration->>'passScore')::integer AS pass_score,
            lg.configuration->>'externalUrl' AS external_url,
            COALESCE(scp.status = 'COMPLETED', FALSE) AS completed
     FROM module_contents mc
     JOIN modules m ON m.id = mc.module_id AND m.is_active = TRUE
     JOIN classes c ON c.id = m.class_id AND c.is_active = TRUE
     JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = $2 AND cs.is_active = TRUE
     JOIN learning_games lg ON lg.module_content_id = mc.id AND lg.is_active = TRUE
     LEFT JOIN student_content_progress scp
       ON scp.module_content_id = mc.id AND scp.student_id = $2
     WHERE mc.module_id = $1 AND mc.content_type = 'GAME' AND mc.is_active = TRUE
       AND (
         NOT EXISTS (
           SELECT 1 FROM modules previous
           WHERE previous.class_id = c.id AND previous.is_active = TRUE
             AND previous.position < m.position
         )
         OR NOT EXISTS (
           SELECT 1 FROM modules previous
           WHERE previous.class_id = c.id AND previous.is_active = TRUE
             AND previous.position < m.position
             AND (
               EXISTS (
                 SELECT 1 FROM module_contents prior_content
                 WHERE prior_content.module_id = previous.id
                   AND prior_content.is_active = TRUE AND prior_content.is_required = TRUE
                   AND NOT EXISTS (
                     SELECT 1 FROM student_content_progress prior_progress
                     WHERE prior_progress.module_content_id = prior_content.id
                       AND prior_progress.student_id = $2 AND prior_progress.status = 'COMPLETED'
                   )
               )
               OR EXISTS (
                 SELECT 1 FROM assignments prior_assignment
                 WHERE prior_assignment.module_id = previous.id
                   AND prior_assignment.is_active = TRUE AND prior_assignment.is_required = TRUE
                   AND NOT EXISTS (
                     SELECT 1 FROM assignment_submissions submission
                     WHERE submission.assignment_id = prior_assignment.id
                       AND submission.student_id = $2
                   )
               )
               OR EXISTS (
                 SELECT 1 FROM assessments prior_assessment
                 WHERE prior_assessment.module_id = previous.id
                   AND prior_assessment.is_active = TRUE AND prior_assessment.is_required = TRUE
                   AND NOT EXISTS (
                     SELECT 1 FROM assessment_attempts attempt
                     WHERE attempt.assessment_id = prior_assessment.id
                       AND attempt.student_id = $2
                       AND attempt.status IN ('SUBMITTED', 'GRADED')
                   )
               )
             )
         )
       )
     ORDER BY mc.position`,
    [moduleId, getUserId(response)],
  );
  if (rows.length === 0) {
    const { rowCount } = await pool.query(
      `SELECT 1 FROM modules m JOIN classes c ON c.id = m.class_id
       JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = $2 AND cs.is_active = TRUE
       WHERE m.id = $1 AND m.is_active = TRUE AND c.is_active = TRUE`,
      [moduleId, getUserId(response)],
    );
    if (rowCount !== 1) {
      response.status(404).json({ error: "Modul tidak ditemukan." });
      return;
    }
  }
  response.json({
    games: rows.map((row) => ({
      id: row.id,
      gameId: row.game_id,
      title: row.title,
      description: row.description,
      position: row.position,
      isRequired: row.is_required,
      questionCount: row.question_count,
      passScore: row.pass_score,
      externalUrl: row.external_url,
      completed: row.completed,
    })),
  });
});

studentRouter.get("/games/:gameId", async (request, response) => {
  const gameId = idFrom(request.params.gameId);
  if (!gameId) {
    response.status(400).json({ error: "ID game tidak valid." });
    return;
  }
  const { rows } = await pool.query<QueryResultRow & {
    id: string;
    content_id: string;
    module_id: string;
    configuration: GameConfiguration;
    latest_score: number | null;
    latest_max_score: number | null;
    latest_passed: boolean | null;
  }>(
    `SELECT lg.id, mc.id AS content_id, mc.module_id, lg.configuration,
            latest.score AS latest_score, latest.max_score AS latest_max_score,
            latest.passed AS latest_passed
     FROM learning_games lg
     JOIN module_contents mc ON mc.id = lg.module_content_id
     JOIN modules m ON m.id = mc.module_id AND m.is_active = TRUE
     JOIN classes c ON c.id = m.class_id AND c.is_active = TRUE
     JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = $2 AND cs.is_active = TRUE
     LEFT JOIN LATERAL (
       SELECT score, max_score, passed
       FROM learning_game_attempts
       WHERE learning_game_id = lg.id AND student_id = $2
       ORDER BY submitted_at DESC
       LIMIT 1
     ) latest ON TRUE
     WHERE lg.id = $1 AND lg.is_active = TRUE AND mc.is_active = TRUE
       AND (
         NOT EXISTS (
           SELECT 1 FROM modules previous
           WHERE previous.class_id = c.id AND previous.is_active = TRUE
             AND previous.position < m.position
         )
         OR NOT EXISTS (
           SELECT 1 FROM modules previous
           WHERE previous.class_id = c.id AND previous.is_active = TRUE
             AND previous.position < m.position
             AND (
               EXISTS (
                 SELECT 1 FROM module_contents prior_content
                 WHERE prior_content.module_id = previous.id
                   AND prior_content.is_active = TRUE AND prior_content.is_required = TRUE
                   AND NOT EXISTS (
                     SELECT 1 FROM student_content_progress prior_progress
                     WHERE prior_progress.module_content_id = prior_content.id
                       AND prior_progress.student_id = $2 AND prior_progress.status = 'COMPLETED'
                   )
               )
               OR EXISTS (
                 SELECT 1 FROM assignments prior_assignment
                 WHERE prior_assignment.module_id = previous.id
                   AND prior_assignment.is_active = TRUE AND prior_assignment.is_required = TRUE
                   AND NOT EXISTS (
                     SELECT 1 FROM assignment_submissions submission
                     WHERE submission.assignment_id = prior_assignment.id
                       AND submission.student_id = $2
                   )
               )
               OR EXISTS (
                 SELECT 1 FROM assessments prior_assessment
                 WHERE prior_assessment.module_id = previous.id
                   AND prior_assessment.is_active = TRUE AND prior_assessment.is_required = TRUE
                   AND NOT EXISTS (
                     SELECT 1 FROM assessment_attempts attempt
                     WHERE attempt.assessment_id = prior_assessment.id
                       AND attempt.student_id = $2
                       AND attempt.status IN ('SUBMITTED', 'GRADED')
                   )
               )
             )
         )
       )`,
    [gameId, getUserId(response)],
  );
  const game = rows[0];
  if (!game) {
    response.status(404).json({ error: "Game tidak ditemukan atau modul masih terkunci." });
    return;
  }
  const { instructions, passScore, questions } = game.configuration;
  response.json({
    game: {
      id: game.id,
      contentId: game.content_id,
      moduleId: game.module_id,
      instructions,
      passScore,
      questions: questions.map(({ id, prompt, choices }) => ({ id, prompt, choices })),
      latestResult: game.latest_score === null
        ? null
        : {
            score: game.latest_score,
            maxScore: game.latest_max_score,
            passed: game.latest_passed,
          },
    },
  });
});

studentRouter.post("/games/:gameId/submit", async (request, response) => {
  const gameId = idFrom(request.params.gameId);
  const rawAnswers = request.body?.answers;
  if (
    !gameId ||
    !Array.isArray(rawAnswers) ||
    rawAnswers.length > 20 ||
    rawAnswers.some((item) =>
      !item ||
      typeof item !== "object" ||
      typeof item.questionId !== "string" ||
      typeof item.choiceId !== "string"
    )
  ) {
    response.status(400).json({ error: "Jawaban game tidak valid." });
    return;
  }
  const answers = rawAnswers as GameAnswer[];
  if (new Set(answers.map((answer) => answer.questionId)).size !== answers.length) {
    response.status(400).json({ error: "Terdapat jawaban soal yang duplikat." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<QueryResultRow & {
      id: string;
      content_id: string;
      module_id: string;
      class_id: string;
      is_required: boolean;
      configuration: GameConfiguration;
    }>(
      `SELECT lg.id, mc.id AS content_id, mc.module_id, m.class_id,
              mc.is_required, lg.configuration
       FROM learning_games lg
       JOIN module_contents mc ON mc.id = lg.module_content_id AND mc.is_active = TRUE
       JOIN modules m ON m.id = mc.module_id AND m.is_active = TRUE
       JOIN classes c ON c.id = m.class_id AND c.is_active = TRUE
       JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = $2 AND cs.is_active = TRUE
       WHERE lg.id = $1 AND lg.is_active = TRUE
         AND (
           NOT EXISTS (
             SELECT 1 FROM modules previous
             WHERE previous.class_id = c.id AND previous.is_active = TRUE
               AND previous.position < m.position
           )
           OR NOT EXISTS (
             SELECT 1 FROM modules previous
             WHERE previous.class_id = c.id AND previous.is_active = TRUE
               AND previous.position < m.position
               AND (
                 EXISTS (
                   SELECT 1 FROM module_contents prior_content
                   WHERE prior_content.module_id = previous.id
                     AND prior_content.is_active = TRUE AND prior_content.is_required = TRUE
                     AND NOT EXISTS (
                       SELECT 1 FROM student_content_progress prior_progress
                       WHERE prior_progress.module_content_id = prior_content.id
                         AND prior_progress.student_id = $2 AND prior_progress.status = 'COMPLETED'
                     )
                 )
                 OR EXISTS (
                   SELECT 1 FROM assignments prior_assignment
                   WHERE prior_assignment.module_id = previous.id
                     AND prior_assignment.is_active = TRUE AND prior_assignment.is_required = TRUE
                     AND NOT EXISTS (
                       SELECT 1 FROM assignment_submissions submission
                       WHERE submission.assignment_id = prior_assignment.id
                         AND submission.student_id = $2
                     )
                 )
                 OR EXISTS (
                   SELECT 1 FROM assessments prior_assessment
                   WHERE prior_assessment.module_id = previous.id
                     AND prior_assessment.is_active = TRUE AND prior_assessment.is_required = TRUE
                     AND NOT EXISTS (
                       SELECT 1 FROM assessment_attempts attempt
                       WHERE attempt.assessment_id = prior_assessment.id
                         AND attempt.student_id = $2
                         AND attempt.status IN ('SUBMITTED', 'GRADED')
                     )
                 )
               )
           )
         )
       FOR UPDATE OF lg`,
      [gameId, getUserId(response)],
    );
    const game = rows[0];
    if (!game) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Game tidak ditemukan atau modul masih terkunci." });
      return;
    }
    if (game.configuration.questions.length === 0) {
      await client.query("ROLLBACK");
      response.status(400).json({ error: "Game tautan eksternal tidak menerima jawaban melalui LMS." });
      return;
    }
    const questionIds = new Set(game.configuration.questions.map((question) => question.id));
    if (
      answers.length !== questionIds.size ||
      answers.some((answer) =>
        !questionIds.has(answer.questionId) ||
        !game.configuration.questions.find((question) => question.id === answer.questionId)
          ?.choices.some((choice) => choice.id === answer.choiceId)
      )
    ) {
      await client.query("ROLLBACK");
      response.status(400).json({ error: "Jawaban harus mencakup setiap soal dengan pilihan yang tersedia." });
      return;
    }
    const correctCount = game.configuration.questions.reduce((total, question) =>
      total + Number(answers.some((answer) =>
        answer.questionId === question.id && answer.choiceId === question.answerId
      )), 0);
    const maxScore = game.configuration.questions.length;
    const score = Math.round((correctCount / maxScore) * 100);
    const passed = score >= game.configuration.passScore;
    const { rows: attemptRows } = await client.query<QueryResultRow & { id: string }>(
      `INSERT INTO learning_game_attempts
         (learning_game_id, student_id, score, max_score, passed, answers)
       VALUES ($1, $2, $3, 100, $4, $5::jsonb)
       RETURNING id`,
      [
        game.id,
        getUserId(response),
        score,
        passed,
        JSON.stringify(answers.map(({ questionId, choiceId }) => ({ questionId, choiceId }))),
      ],
    );
    if (passed && game.is_required) {
      await client.query(
        `INSERT INTO student_content_progress
           (student_id, module_content_id, status, started_at, completed_at)
         VALUES ($1, $2, 'COMPLETED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (student_id, module_content_id) DO UPDATE
         SET status = 'COMPLETED',
             completed_at = COALESCE(student_content_progress.completed_at, CURRENT_TIMESTAMP),
             updated_at = CURRENT_TIMESTAMP`,
        [getUserId(response), game.content_id],
      );
    }
    const { rows: moduleCounts } = await client.query<QueryResultRow & {
      required_count: number;
      completed_count: number;
      next_module_id: string | null;
    }>(
      `SELECT
         ((SELECT COUNT(*) FROM module_contents
           WHERE module_id = $2 AND is_active = TRUE AND is_required = TRUE)
          + (SELECT COUNT(*) FROM assignments
             WHERE module_id = $2 AND is_active = TRUE AND is_required = TRUE)
          + (SELECT COUNT(*) FROM assessments
             WHERE module_id = $2 AND is_active = TRUE AND is_required = TRUE))::integer AS required_count,
         (SELECT COUNT(*) FROM module_contents mc
          JOIN student_content_progress scp ON scp.module_content_id = mc.id
            AND scp.student_id = $1 AND scp.status = 'COMPLETED'
          WHERE mc.module_id = $2 AND mc.is_active = TRUE AND mc.is_required = TRUE)
          + (SELECT COUNT(*) FROM assignments a
             WHERE a.module_id = $2 AND a.is_active = TRUE AND a.is_required = TRUE
               AND EXISTS (SELECT 1 FROM assignment_submissions submission
                           WHERE submission.assignment_id = a.id AND submission.student_id = $1))
          + (SELECT COUNT(*) FROM assessments a
             WHERE a.module_id = $2 AND a.is_active = TRUE AND a.is_required = TRUE
               AND EXISTS (SELECT 1 FROM assessment_attempts attempt
                           WHERE attempt.assessment_id = a.id AND attempt.student_id = $1
                             AND attempt.status IN ('SUBMITTED', 'GRADED')))::integer AS completed_count,
         (SELECT next_module.id FROM modules current
          JOIN modules next_module ON next_module.class_id = current.class_id
            AND next_module.position > current.position AND next_module.is_active = TRUE
          WHERE current.id = $2 AND current.is_active = TRUE
          ORDER BY next_module.position LIMIT 1) AS next_module_id`,
      [getUserId(response), game.module_id],
    );
    const counts = moduleCounts[0];
    if (!counts) throw new Error("Progres modul tidak dapat dihitung.");
    const progress = counts.required_count === 0
      ? 100
      : Math.round((counts.completed_count / counts.required_count) * 100);
    const moduleCompleted = counts.completed_count === counts.required_count;
    await client.query(
      `INSERT INTO student_module_progress
         (student_id, module_id, status, progress_percent, started_at, completed_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP,
               CASE WHEN $3 = 'COMPLETED' THEN CURRENT_TIMESTAMP ELSE NULL END)
       ON CONFLICT (student_id, module_id) DO UPDATE
       SET status = EXCLUDED.status,
           progress_percent = EXCLUDED.progress_percent,
           started_at = COALESCE(student_module_progress.started_at, CURRENT_TIMESTAMP),
           completed_at = EXCLUDED.completed_at,
           updated_at = CURRENT_TIMESTAMP`,
      [getUserId(response), game.module_id, moduleCompleted ? "COMPLETED" : "IN_PROGRESS", progress],
    );
    await client.query(
      `INSERT INTO activity_logs (user_id, event_type, entity_type, entity_id, details)
       VALUES ($1, 'GAME_COMPLETED', 'GAME', $2, $3::jsonb)`,
      [getUserId(response), game.id, JSON.stringify({ score, passed })],
    );
    await client.query("COMMIT");
    response.json({
      attemptId: attemptRows[0]?.id,
      score,
      maxScore: 100,
      passed,
      passScore: game.configuration.passScore,
      moduleProgress: progress,
      moduleCompleted,
      nextModuleUnlocked: moduleCompleted && counts.next_module_id !== null,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

export { studentRouter as studentGamesRouter, teacherRouter as teacherGamesRouter };
