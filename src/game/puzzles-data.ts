/* 自动生成，勿手改。运行 npm run gen 重新生成。 */
export interface RawPuzzle {
  id: string
  name: string
  width: number
  height: number
  difficulty: 'easy' | 'medium' | 'hard' | 'custom'
  series: string
  /** 题面编码串（格式由 src/game/puzzles.ts 解析） */
  board: string
  /** 参考解编码串（没有则留空） */
  solution?: string
}

export const RAW_PUZZLES: RawPuzzle[] = [
  { id: "kakurasu-6x6-kvp9fl", name: "初识方阵", width: 6, height: 6, difficulty: 'easy', series: "入门", board: "9,7,12,8,18,7|16,21,0,14,11,9", solution: "112221212212212121112212112111112122" },
  { id: "kakurasu-7x7-kvp9fm", name: "七阶权值", width: 7, height: 7, difficulty: 'easy', series: "入门", board: "22,5,6,11,27,23,17|10,21,24,10,15,19,19", solution: "2111211211222211122222121122211111121121111212211" },
  { id: "kakurasu-8x8-kvp9fn", name: "方阵回廊", width: 8, height: 8, difficulty: 'medium', series: "进阶", board: "22,7,15,9,20,23,33,6|3,10,16,35,18,19,13,16", solution: "1212111211212222221122212221122222112112222111212211111121212222" },
  { id: "kakurasu-8x8-kvp9fo", name: "权重迷阵", width: 8, height: 8, difficulty: 'medium', series: "进阶", board: "17,6,6,11,20,24,13,18|30,7,11,26,14,1,15,26", solution: "1112112212221222122212221212221212212211211122111221222112211221" },
  { id: "kakurasu-8x8-kvp9fp", name: "方阵之影", width: 8, height: 8, difficulty: 'hard', series: "挑战", board: "21,13,35,36,23,29,14,17|18,30,20,13,20,26,27,23", solution: "1122111221122221211111111111111121121112121121111122112221222211" },
  { id: "kakurasu-8x8-kvp9fq", name: "方阵终局", width: 8, height: 8, difficulty: 'hard', series: "挑战", board: "7,27,35,26,23,23,11,18|15,26,19,17,31,30,15,14", solution: "2211222212221111211111112112211111111221211211122222112211211122" },
]
