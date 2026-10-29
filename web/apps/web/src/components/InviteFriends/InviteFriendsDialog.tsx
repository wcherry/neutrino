'use client';

/**
 * "Invite friends" from the account menu: the panel in a modal. The shell loads
 * this with `next/dynamic`, so none of it is in any route's first-load JS.
 */

import React from 'react';
import { Modal, ModalBody, ModalHeader } from '@neutrino/ui';
import { InviteFriendsPanel } from './InviteFriendsPanel';

export interface InviteFriendsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function InviteFriendsDialog({ open, onClose }: InviteFriendsDialogProps) {
  return (
    <Modal open={open} onClose={onClose} size="md">
      <ModalHeader title="Invite friends" onClose={onClose} />
      <ModalBody>
        <InviteFriendsPanel autoFocus />
      </ModalBody>
    </Modal>
  );
}

export default InviteFriendsDialog;
