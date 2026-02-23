declare module "cli-table3" {
  type TableRow = Array<string | number>;

  interface TableOptions {
    head?: string[];
    wordWrap?: boolean;
  }

  class Table {
    constructor(options?: TableOptions);
    push(...rows: TableRow[]): number;
    toString(): string;
  }

  export default Table;
}
