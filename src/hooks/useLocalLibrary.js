import { useState } from 'react';
import useLocalStorage from './useLocalStorage';
import { initialReviews, initialTopics } from '../data/study';
import { activityType, findLegacyReviewId, subjectId, unassigned } from '../data/library';

export function readLocal(key, fallback) {
  try { return JSON.parse(localStorage.getItem('repasito.v2.' + key)) ?? fallback; }
  catch { return fallback; }
}

function assignLegacyTopics(topics) {
  return topics.some(topic => !topic.subjectId)
    ? topics.map(topic => topic.subjectId ? topic : { ...topic, subjectId: unassigned.id })
    : topics;
}

function usedLegacyLibrary() {
  const some = (key, predicate) => {
    const entries = readLocal(key, []);
    return Array.isArray(entries) && entries.some(predicate);
  };
  return some('topics', topic => !topic.subjectId)
    || some('reviews', item => !item.type)
    || some('plans', plan => !plan.days)
    || some('sessions', entry => !Object.hasOwn(entry, 'reviewId'))
    || readLocal('device', {}).queued === true;
}

export function associateAttempts(history, items) {
  if (history.every(entry => Object.hasOwn(entry, 'reviewId'))) return history;
  return history.map(entry => Object.hasOwn(entry, 'reviewId') ? entry : {
    ...entry, reviewId: findLegacyReviewId(entry, items), type: entry.type || 'choice',
  });
}

export function mergeById(previous, incoming) {
  const ids = new Set(previous.map(entry => entry.id));
  return [...previous, ...incoming.filter(entry => !ids.has(entry.id))];
}

export default function useLocalLibrary() {
  const [legacyLibrary] = useState(usedLegacyLibrary);
  const [subjects, setSubjects, subjectsError] = useLocalStorage('repasito.v2.subjects', []);
  const [topics, setTopics, topicsError] = useLocalStorage('repasito.v2.topics',
    legacyLibrary ? initialTopics : [], assignLegacyTopics, legacyLibrary);
  const defaultItems = legacyLibrary ? initialReviews.filter(item => topics.some(topic => topic.id === item.topicId)) : [];
  const [reviews, setReviews, reviewsError] = useLocalStorage('repasito.v2.reviews', defaultItems, undefined, legacyLibrary);

  return {
    library: { subjects, topics, reviews },
    setters: { subjects: setSubjects, topics: setTopics, reviews: setReviews },
    error: subjectsError || topicsError || reviewsError,
  };
}

export function importPayload(library) {
  const subjects = [...library.subjects];
  if (library.topics.some(topic => subjectId(topic) === unassigned.id) && !subjects.some(subject => subject.id === unassigned.id)) {
    subjects.push(unassigned);
  }
  return {
    subjects,
    topics: library.topics.map(topic => ({ ...topic, subjectId: subjectId(topic) })),
    reviews: library.reviews.map(review => ({ ...review, type: activityType(review) })),
  };
}
