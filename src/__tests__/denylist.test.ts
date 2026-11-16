import { describe, expect, it } from 'vitest';
import { isAudited } from '../config.js';

describe('isAudited (AUDIT_DENYLIST)', () => {
  it('calla la conversación del chat por prefijo: mensajes, reacciones, miembros y leído', () => {
    for (const key of [
      'chat.message.created',
      'chat.message.updated',
      'chat.message.deleted',
      'chat.reaction.added',
      'chat.reaction.removed',
      'chat.member.joined',
      'chat.member.left',
      'chat.conversation.read',
    ]) {
      expect(isAudited(key), key).toBe(false);
    }
  });

  it('sí registra crear, renombrar y archivar canales', () => {
    for (const key of ['chat.conversation.created', 'chat.conversation.updated', 'chat.conversation.archived', 'chat.conversation.unarchived']) {
      expect(isAudited(key), key).toBe(true);
    }
  });

  it('una entrada exacta no se comporta como prefijo, y el resto del sistema se sigue auditando', () => {
    expect(isAudited('chat.conversation.readers_changed')).toBe(true);
    expect(isAudited('projects.task.created')).toBe(true);
    expect(isAudited('billing.invoice.issued')).toBe(true);
    // «chat.messages» no empieza por «chat.message.»: el punto final del prefijo evita callar otra familia por accidente.
    expect(isAudited('chat.messages_purged')).toBe(true);
  });
});
