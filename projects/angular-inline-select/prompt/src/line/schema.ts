// 3rd Party
import { MarkSpec, NodeSpec, Schema } from 'prosemirror-model';

// Editables
import { Extension } from './extension';

/**
 * Builds a ProseMirror {@link Schema} from a list of extensions. Node and mark
 * order follows the array order, which matters for parse precedence and mark
 * nesting.
 */
export function createSchema(extensions: Extension[]): Schema {
  const nodes: Record<string, NodeSpec> = {};
  const marks: Record<string, MarkSpec> = {};
  let topNode: string | undefined;

  for (const extension of extensions) {
    switch (extension.type) {
      case 'node':
        if (nodes[extension.name]) {
          throw new Error(`Duplicate node extension "${extension.name}"`);
        }
        nodes[extension.name] = extension.spec;
        if (extension.topNode) topNode = extension.name;
        break;
      case 'mark':
        if (marks[extension.name]) {
          throw new Error(`Duplicate mark extension "${extension.name}"`);
        }
        marks[extension.name] = extension.spec;
        break;
      case 'extension':
        break;
    }
  }

  if (!topNode) {
    throw new Error('No top node defined: one node extension must set `topNode: true`');
  }

  return new Schema({ nodes, marks, topNode });
}
