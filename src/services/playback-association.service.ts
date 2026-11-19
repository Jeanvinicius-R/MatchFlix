import {
  createAssociationRecord,
  deleteAssociationRecord,
  findAssociationById,
  listAssociationRecords,
  updateAssociationAvailability,
  updateAssociationRights,
} from "@/repositories/playback-association.repository";
import { adapters } from "@/services/playback/adapters/registry";
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

export const {
  listAssociations,
  createAssociation,
  setAssociationRights,
  verifyAssociation,
  removeAssociation,
  seedOpenFilmAssociations,
  listAdapters,
} = service;
