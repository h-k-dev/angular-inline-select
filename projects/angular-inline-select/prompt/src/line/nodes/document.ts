// Editables
import { defineNode } from '../extension';

export const Document = defineNode({
  name: 'doc',
  topNode: true,
  spec: { content: 'block+' },
});
