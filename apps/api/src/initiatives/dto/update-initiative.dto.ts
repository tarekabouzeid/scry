import { PartialType } from "@nestjs/swagger";
import { CreateInitiativeDto } from "./create-initiative.dto";

export class UpdateInitiativeDto extends PartialType(CreateInitiativeDto) {}
