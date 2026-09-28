import { ApiProperty } from "@nestjs/swagger";
import { IsString, MaxLength, MinLength } from "class-validator";

export class SignalDto {
  // The reason is what makes demand useful to the owners and in the brief;
  // a bare count says little. Saying it again confirms the need is current.
  @ApiProperty({ description: "Why your team needs it." })
  @IsString()
  @MinLength(3, { message: "Say in a few words why your team needs it" })
  @MaxLength(280)
  note!: string;
}
