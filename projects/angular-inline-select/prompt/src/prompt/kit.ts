// Editables
import { Extension } from '../line/extension';
import { createSchema } from '../line/schema';
import { Document } from '../line/nodes/document';
import { Text } from '../line/nodes/text';
import { HardBreak } from '../line/nodes/hard-break';
import { PromptLine } from './nodes/line';

/**
 * The prompt editor's extension set: a flat document of lines and nothing
 * inline but text. No marks: a prompt is read by a model, and Markdown's
 * emphasis is noise to it more often than signal — the shapes that do carry
 * meaning to a model are the line shapes. Formatting on a paste is dropped.
 *
 * History and the base keymap are editor concerns rather than document ones,
 * and are added by the component.
 */
export const promptExtensions: Extension[] = [Document, PromptLine, Text, HardBreak];

/**
 * The prompt schema. Built once at module load and shared by every editor and
 * every static render: a document parsed for the page must be one a view can
 * take over, and nodes of two schemas never mix.
 */
export const promptSchema = createSchema(promptExtensions);
