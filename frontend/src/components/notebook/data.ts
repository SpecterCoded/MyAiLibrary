import type { Note, Folder } from './types';

const defaultContent = [
  {
    type: "heading",
    props: { level: 2 },
    content: "What is Navigation Architecture?"
  },
  {
    type: "paragraph",
    content: "Navigation architecture refers to the structure and organization of a website or application's navigation system. It encompasses the hierarchy of content, the placement of navigational elements, and the pathways that users take to access different sections of the digital product. Effective navigation architecture is crucial for enhancing usability and improving the overall user experience."
  },
  { type: "paragraph" },
  {
    type: "heading",
    props: { level: 2 },
    content: "Why is Navigation Architecture Important?"
  },
  {
    type: "numberedListItem",
    content: [
      { type: "text", text: "User Experience: ", styles: { bold: true } },
      { type: "text", text: "Good navigation architecture ensures that users can find what they are looking for without frustration. It reduces the "},
      { type: "text", text: "cognitive load", styles: { underline: true } },
      { type: "text", text: " and makes the interaction with the digital product intuitive and enjoyable." }
    ]
  },
  { type: "paragraph" },
  {
    type: "numberedListItem",
    content: [
      { type: "text", text: "Engagement and Retention: ", styles: { bold: true } },
      { type: "text", text: "When users can navigate easily, they are more likely to stay longer, explore more content, and return in the future. Poor navigation, on the other hand, can lead to higher bounce rates and lower user retention." }
    ]
  }
];

export const INITIAL_FOLDERS: Folder[] = [
  { id: 'f1', name: 'Equal. Product Design Agency', parentId: null, icon: '💚' },
  { id: 'f2', name: 'Estimate. OlderVoid team', parentId: 'f1', icon: 'folder' },
  { id: 'f3', name: 'UX audit & Nav Architecture', parentId: 'f1', icon: 'folder' },
  { id: 'f4', name: 'Dribbble shots', parentId: null, icon: '🏀' },
  { id: 'f5', name: 'Personal stuff', parentId: null, icon: '🤓' },
  { id: 'f6', name: 'Design inspiration', parentId: null, icon: '🍒' },
  { id: 'f7', name: 'Something to read', parentId: null, icon: '📚' },
  { id: 'f8', name: 'Draft', parentId: null, icon: '👽' },
];

export const INITIAL_NOTES: Note[] = [
  {
    id: 'n1',
    title: 'The Essentials of Navigation Architecture.',
    content: defaultContent,
    folderId: 'f3',
    status: 'active',
    isFavorite: false,
    tags: [
      { label: 'Design Thinking', colorClass: 'text-[#1E7D53]', bgClass: 'bg-[#E7F3ED]' },
      { label: 'UI/UX Design', colorClass: 'text-[#1A73E8]', bgClass: 'bg-[#E8F0FE]' }
    ],
    links: ['n2', 'n3'],
    createdAt: Date.now() - 172800000,
    updatedAt: Date.now() - 43200000,
    icon: '📄'
  },
  {
    id: 'n2',
    title: 'UX audit',
    content: [],
    folderId: 'f3',
    status: 'active',
    isFavorite: false,
    tags: [],
    links: ['n1', 'n5'],
    createdAt: Date.now() - 500000000,
    updatedAt: Date.now() - 400000000,
    icon: '📝'
  },
  {
    id: 'n3',
    title: 'How to work with Design systems...',
    content: [],
    folderId: null,
    status: 'active',
    isFavorite: true,
    tags: [],
    links: ['n4'],
    createdAt: Date.now() - 600000000,
    updatedAt: Date.now() - 500000000,
    icon: '🎉'
  },
  {
    id: 'n4',
    title: 'Typography. Chapter 1. Lesson 3',
    content: [],
    folderId: null,
    status: 'active',
    isFavorite: true,
    tags: [],
    links: ['n3'],
    createdAt: Date.now() - 700000000,
    updatedAt: Date.now() - 600000000,
    icon: '💡'
  },
  {
    id: 'n5',
    title: 'Technical task for UX Designer.',
    content: [],
    folderId: null,
    status: 'active',
    isFavorite: true,
    tags: [],
    links: ['n2'],
    createdAt: Date.now() - 800000000,
    updatedAt: Date.now() - 700000000,
    icon: '📍'
  },
  {
    id: 'd1',
    title: 'Draft notes on architecture',
    content: [],
    folderId: null,
    status: 'draft',
    isFavorite: false,
    tags: [],
    createdAt: Date.now() - 100000,
    updatedAt: Date.now() - 100000,
    icon: '📄'
  },
  {
    id: 'd2',
    title: 'Meeting sync points',
    content: [],
    folderId: null,
    status: 'draft',
    isFavorite: false,
    tags: [],
    createdAt: Date.now() - 200000,
    updatedAt: Date.now() - 200000,
    icon: '📄'
  },
  {
    id: 'd3',
    title: 'Design system specs',
    content: [],
    folderId: null,
    status: 'draft',
    isFavorite: false,
    tags: [],
    createdAt: Date.now() - 300000,
    updatedAt: Date.now() - 300000,
    icon: '📄'
  }
];

for (let i = 1; i <= 12; i++) {
   INITIAL_NOTES.push({
    id: `del${i}`,
    title: `Deleted old element ${i}`,
    content: [],
    folderId: null,
    status: 'deleted',
    isFavorite: false,
    tags: [],
    createdAt: Date.now() - 900000000,
    updatedAt: Date.now() - 800000000,
    icon: '🗑️'
   });
}
