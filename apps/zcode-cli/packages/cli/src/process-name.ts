export const CLI_COMMAND_NAME = "zz";
export const CLI_PROCESS_NAME = "zz-cli";

interface ProcessTitleTarget {
  title: string;
}

export const setCliProcessTitle = (
  target: ProcessTitleTarget = process,
): void => {
  target.title = CLI_PROCESS_NAME;
};
