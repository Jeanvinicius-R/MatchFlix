import {
  createAssociationRecord,
  deleteAssociationRecord,
  findAssociationById,
  listAssociationRecords,
  updateAssociationAvailability,
  updateAssociationRights,
} from "@/repositories/playback-association.repository";
import { adapters } from "@/services/playback/adapters/registry";
import { invalidatingPlayable } from "@/services/playback/playable-titles.default";
import {
  createAssociationService,
  type AssociationRepository,
} from "@/services/playback/association.service-core";

/**
 * Default association service: Prisma repository + the real adapter registry.
 * The logic (and its tests) live in playback/association.service-core.ts.
 */

export {
  AssociationAlreadyExistsError,
  AssociationNotFoundError,
  LicenseReferenceRequiredError,
  UnknownProviderError,
  type AssociationView,
} from "@/services/playback/association.service-core";

const repository: AssociationRepository = {
  list: listAssociationRecords,
  findById: findAssociationById,
  create: createAssociationRecord,
  updateRights: updateAssociationRights,
  updateAvailability: updateAssociationAvailability,
  remove: deleteAssociationRecord,
};

const service = createAssociationService({ repository, adapters });

export const { listAssociations, listAdapters } = service;

// Every write refreshes the "has video" card badges right away.
export const createAssociation = invalidatingPlayable(service.createAssociation);
export const setAssociationRights = invalidatingPlayable(service.setAssociationRights);
export const verifyAssociation = invalidatingPlayable(service.verifyAssociation);
export const removeAssociation = invalidatingPlayable(service.removeAssociation);
export const seedOpenFilmAssociations = invalidatingPlayable(
  service.seedOpenFilmAssociations,
);
