import { ApiProperty } from "@nestjs/swagger";
import { IsIn } from "class-validator";

export class ResolveOverlapDto {
  @ApiProperty({ enum: ["open", "dismissed", "linked"] })
  @IsIn(["open", "dismissed", "linked"])
  status!: "open" | "dismissed" | "linked";
}
