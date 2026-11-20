import { dateKey } from './study.js';

export const unassigned = { id: 'por-asignar', name: 'Por asignar' };
export const activities = {
  all: 'Todas las actividades',
  recall: 'Recuerdo activo',
  flashcard: 'Flashcards',
  choice: 'Opción múltiple',
};

export const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export const subjectId = topic => topic.subjectId || unassigned.id;
export const activityType = item => item.type || 'choice';
export const itemName = item => item.name || item.question;
export const planDays = plan => plan.days ?? days.filter(day => plan['day-' + day]);
const hasTime = plan => /^([01]\d|2[0-3]):[0-5]\d$/.test(plan.time);

export function findLegacyReviewId(attempt, items) {
  const matches = items.filter(item => item.topicId === attempt.topicId && item.name === attempt.reviewName);
  return matches.length === 1 ? matches[0].id : null;
}

export function localTime(date) {
  return date.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
    + ' · ' + date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function scheduledDate(plan, day) {
  if (!hasTime(plan) || !planDays(plan).includes(days[(day.getDay() + 6) % 7])) return null;
  const [hours, minutes] = plan.time.split(':').map(Number);
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes);
  return start.getHours() === hours && start.getMinutes() === minutes ? start : null;
}

export const occurrenceId = (plan, start) => plan.id + ':' + dateKey(start) + 'T' + plan.time;

export function nextOccurrence(plans, completed, now) {
  const recorded = new Set(completed.map(entry => entry.id));
  const occurrences = plans.flatMap(plan => {
    if (!hasTime(plan) || !planDays(plan).length || !(Number(plan.minutes) > 0)) return [];
    const priorCompletions = completed.filter(entry => entry.planId === plan.id).length;
    for (let offset = -1; offset <= 14 + priorCompletions * 7; offset++) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
      const start = scheduledDate(plan, day);
      if (!start) continue;
      const id = occurrenceId(plan, start);
      if (start.getTime() + Number(plan.minutes) * 60000 > now.getTime() && !recorded.has(id)) {
        return [{ plan, start, id }];
      }
    }
    return [];
  });
  return occurrences.sort((a, b) => a.start - b.start)[0];
}

export function getOccurrence(plan, iso) {
  if (!plan || !iso) return null;
  const start = new Date(iso);
  if (Number.isNaN(start.getTime()) || scheduledDate(plan, start)?.getTime() !== start.getTime()) return null;
  return { plan, start, id: occurrenceId(plan, start) };
}

export function weeklyStats(attempts, completed, now) {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (now.getDay() + 6) % 7);
  const start = dateKey(monday);
  const end = dateKey(now);
  const inWeek = entry => entry.date >= start && entry.date <= end;
  const week = attempts.filter(inWeek);
  const finished = completed.filter(inWeek);
  return {
    days: new Set([...week, ...finished].map(entry => entry.date)).size,
    cards: new Set(week.filter(entry => entry.type === 'flashcard' && entry.reviewId).map(entry => entry.reviewId)).size,
    attempts: week.length,
    completed: finished.length,
  };
}

export function mergeStudyAttempts(localAttempts, deviceEvents) {
  if (!deviceEvents.length) return localAttempts;
  const attempts = new Map(localAttempts.map(entry => [entry.id, entry]));
  for (const event of deviceEvents) {
    attempts.set(event.id, {
      id: event.id, date: dateKey(new Date(event.studiedAt)), timestamp: event.studiedAt,
      topicId: event.topicId, topicName: event.topicName, reviewId: event.cardId, reviewName: event.question,
      type: 'flashcard', correct: event.rating === 'remembered',
    });
  }
  const time = entry => new Date(entry.timestamp || entry.date + 'T00:00:00').getTime();
  return [...attempts.values()].sort((a, b) => time(a) - time(b));
}

export function topicsToRevisit(topics, attempts) {
  return topics.map(topic => {
    const entries = attempts.filter(entry => entry.topicId === topic.id);
    const latest = new Map();
    for (const entry of entries) {
      latest.set(entry.reviewId || entry.reviewName || entry.id, entry);
    }
    const pending = [...latest.values()].filter(entry => entry.correct === false);
    return {
      topic,
      cards: pending.filter(entry => entry.type === 'flashcard').length,
      errors: pending.filter(entry => !entry.type || entry.type === 'choice').length,
      recalls: pending.filter(entry => entry.type === 'recall').length,
      total: pending.length,
    };
  }).filter(entry => entry.total).sort((a, b) => b.total - a.total);
}

export const learningPath = (subject, topic) => '#/aprendizaje'
  + (subject ? '/' + encodeURIComponent(subject) : '')
  + (topic ? '/' + encodeURIComponent(topic) : '');

export function practicePath({ subject, topic, activity, item, occurrence, start } = {}) {
  const query = new URLSearchParams();
  if (subject) query.set('materia', subject);
  if (topic) query.set('tema', topic);
  if (activity && activity !== 'all') query.set('actividad', activity);
  if (item) query.set('contenido', item);
  if (start) query.set('inicio', '1');
  if (occurrence) {
    query.set('plan', occurrence.plan.id);
    query.set('sesion', occurrence.start.toISOString());
  }
  const search = query.toString();
  return '#/repasos' + (search ? '?' + search : '');
}
