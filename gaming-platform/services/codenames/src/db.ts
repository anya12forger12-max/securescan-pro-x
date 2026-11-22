import pg from "pg";
import type { Pool as PoolType, PoolClient } from "pg";
import { randomInt } from "node:crypto";
import { dbPoolOptions } from "@gp/config";

const { Pool } = pg;

// A game needs a board before anyone can submit a clue or a guess. The
// recovered service only inserted ids, leaving every word list empty, so a
// freshly created game was permanently unplayable. Generate the standard
// 25-word board here (9/8 coloured, 7 neutral, 1 assassin) using a
// cryptographic shuffle so layouts cannot be predicted by clients.
const WORD_BANK = [
  "AFRICA", "AGENT", "AIR", "ALIEN", "ANGEL", "APPLE", "ARCTIC", "ARM",
  "BALLOON", "BANANA", "BAR", "BASIL", "BEACH", "BEAR", "BENGAL", "BICYCLE",
  "BIRD", "BOMB", "BONUS", "BOOK", "BOTTLE", "BOUNTY", "BRIDGE", "BROOKLYN",
  "BUCKET", "CABIN", "CACTUS", "CAMERA", "CAMP", "CANADA", "CANDLE", "CANNON",
  "CAPITAL", "CAR", "CARIBBEAN", "CASTLE", "CAT", "CELL", "CENTER", "CHAIN",
  "CHAIR", "CHARGE", "CHEF", "CHERRY", "CHEST", "CHICKEN", "CIRCLE", "CLIP",
  "CLOCK", "CLOWN", "CLUB", "COAST", "COFFEE", "COLD", "COMBAT", "COMET",
  "CORAL", "COTTON", "COURT", "COVER", "CRANE", "CRASH", "CRAYON", "CREAM",
  "CREDIT", "CRICKET", "CROWN", "CRUISE", "CRYSTAL", "CUBE", "CULTURE", "CUP",
  "DANCE", "DESERT", "DIAMOND", "DICE", "DINOSAUR", "DIRECTION", "DOG", "DOLL",
  "DOLPHIN", "DOMINO", "DONKEY", "DRAW", "DREAM", "DRESS", "DRIFT", "DRUM",
  "EAGLE", "EARTH", "EGG", "ELEPHANT", "ENERGY", "ENGINE", "EUROPE", "FABLE",
  "FAIRY", "FALL", "FAN", "FARM", "FENCE", "FERRY", "FIELD", "FIRE", "FISH",
  "FLAG", "FLAME", "FLASH", "FLOOD", "FLUTE", "FOOT", "FOREST", "FORK",
  "FORT", "FOUNTAIN", "FRAME", "FROG", "FRUIT", "FUEL", "GAME", "GARDEN",
  "GAS", "GATE", "GEAR", "GEM", "GHOST", "GIANT", "GIFT", "GIRL", "GLASS",
  "GLOBE", "GLOVE", "GOAT", "GOLD", "GRAVITY", "GREEN", "GUITAR", "GUN",
  "HAMMER", "HAMSTER", "HARBOR", "HAT", "HAWK", "HEART", "HELICOPTER", "HIMALAYA",
  "HIVE", "HOLE", "HONEY", "HORSE", "HOSPITAL", "HOTEL", "HOUSE", "ICE",
  "ICECREAM", "ICON", "IGLOO", "ISLAND", "JACKET", "JAGUAR", "JAM", "JET",
  "JEWEL", "JUNGLE", "KANGAROO", "KEY", "KID", "KITE", "KNIFE", "LAB",
  "LADDER", "LAKE", "LAMP", "LAPTOP", "LEAF", "LEMON", "LEPRECHAUN", "LICENSE",
  "LIGHT", "LIMIT", "LION", "LIZARD", "LOCK", "LOLLIPOP", "LONDON", "LUCK",
  "LUNCH", "MAGIC", "MAGNET", "MAPLE", "MARBLE", "MARCH", "MASCOT", "MAZE",
  "MEADOW", "METAL", "MICROSCOPE", "MIDDLE", "MILK", "MIRROR", "MISSILE", "MODEL",
  "MONEY", "MONKEY", "MONTH", "MOON", "MOUSE", "MOUTH", "MOVIE", "MUG",
  "MUSHROOM", "MUSIC", "MYSTERY", "NEEDLE", "NEST", "NET", "NEWSPAPER", "NIGHT",
  "NINJA", "NOTE", "NOVEL", "NURSE", "OCEAN", "OCTOPUS", "OFFICE", "ORANGE",
  "ORBIT", "ORGAN", "OWL", "OX", "OXYGEN", "PALM", "PAN", "PANDA", "PAPER",
  "PARIS", "PARTY", "PASSPORT", "PASTA", "PATCH", "PAWN", "PEACH", "PEARL",
  "PENGUIN", "PENCIL", "PHANTOM", "PHONE", "PHOTO", "PIANO", "PILOT", "PINE",
  "PIPE", "PIRATE", "PISTOL", "PIZZA", "PLANET", "PLASTIC", "PLATE", "PLAY",
  "PLEASURE", "PLUMBER", "POISON", "POLICE", "POOL", "PORT", "POST", "POTATO",
  "POWER", "PRESS", "PRINCESS", "PRISON", "PUZZLE", "PYRAMID", "QUEEN", "QUILT",
  "RABBIT", "RADIO", "RAIN", "RAINBOW", "RAM", "RAMP", "RATION", "RATTLE",
  "REACTOR", "REFRIGERATOR", "RING", "RIVER", "ROAD", "ROBOT", "ROCK", "ROCKET",
  "ROPE", "ROSE", "ROYAL", "RULER", "SABER", "SAIL", "SALAD", "SAND",
  "SCALE", "SCHOOL", "SCIENTIST", "SCREEN", "SCREWDRIVER", "SHADOW", "SHAFT", "SHAKE",
  "SHARK", "SHEEP", "SHELF", "SHELL", "SHIP", "SHOE", "SHOP", "SHOT",
  "SHOW", "SIDE", "SIGN", "SILK", "SILVER", "SKATE", "SKI", "SKULL",
  "SLEEP", "SLICE", "SLIDE", "SLOPE", "SNAKE", "SNOW", "SOCKET", "SOFA",
  "SOFT", "SOLAR", "SOLDIER", "SOLID", "SOLUTION", "SONG", "SPACE", "SPARK",
  "SPEED", "SPIDER", "SPIKE", "SPOON", "SPORT", "SPRING", "SPY", "SQUARE",
  "SQUIRREL", "STADIUM", "STAR", "STATION", "STEAM", "STEEL", "STICK", "STILL",
  "STOCK", "STONE", "STORE", "STORM", "STORY", "STRANGER", "STRAP", "STRAW",
  "STRIPE", "STUDENT", "STUFF", "SUGAR", "SUIT", "SUMMER", "SUN", "SUNGLASSES",
  "SUPERHERO", "SURF", "SURGEON", "SUSPECT", "SWAMP", "SWING", "SWITCH", "SWORD",
  "TABLE", "TANK", "TAPE", "TARGET", "TAXI", "TEACHER", "TELEPHONE", "TELESCOPE",
  "TENNIS", "THEATER", "TICKET", "TIGER", "TIMER", "TIRE", "TITLE", "TOAST",
  "TOKEN", "TOMATO", "TOOTH", "TORCH", "TORNADO", "TOWER", "TOWN", "TOY",
  "TRACK", "TRADE", "TRAFFIC", "TRAIL", "TRAIN", "TRAMPOLINE", "TRAP", "TRAVEL",
  "TREAT", "TREE", "TRICK", "TRIP", "TROPHY", "TRUCK", "TRUMPET", "TRUNK",
  "TRUST", "TUBE", "TUNNEL", "TURKEY", "TURN", "TURTLE", "TWINS", "UMBRELLA",
  "UNICORN", "UNIFORM", "UNIVERSE", "VACATION", "VACCINE", "VALLEY", "VAMPIRE", "VAN",
  "VANILLA", "VASE", "VEGETABLE", "VEHICLE", "VELVET", "VENUS", "VERTEX", "VIOLIN",
  "VIRUS", "VISOR", "VOLCANO", "VOLLEYBALL", "WAGON", "WALL", "WALLET", "WAR",
  "WASHINGTON", "WATCH", "WATER", "WAVE", "WEAPON", "WEATHER", "WEB", "WEDDING",
  "WEEKEND", "WEIGHT", "WHALE", "WHEAT", "WHEEL", "WHIP", "WHISTLE", "WITCH",
  "WIZARD", "WOOD", "WOOL", "WORD", "WORLD", "WORM", "WORSHIP", "WOUNDED",
  "WRENCH", "WRIST", "WRITE", "WRONG", "YACHT", "YARD", "YEAR", "YOGA",
  "YOGURT", "ZEBRA", "ZONE",
];

type Queryable = PoolType | PoolClient;

export type Team = "red" | "blue";
export type GameStatus = "setup" | "active" | "ended";
export type GuessOutcome = "correct" | "wrong_team" | "neutral" | "assassin" | "invalid_word";

export interface GameRow {
  id: string;
  session_id: string | null;
  host_id: string;
  red_team_words: string[];
  blue_team_words: string[];
  neutral_words: string[];
  assassin_word: string;
  status: GameStatus;
  current_team: Team;
  winner: Team | null;
  created_at: Date;
  ended_at: Date | null;
}

export interface ClueRow {
  id: string;
  game_id: string;
  spymaster_id: string;
  word: string;
  number: number;
  created_at: Date;
}

export interface GuessRow {
  id: string;
  game_id: string;
  user_id: string;
  username: string;
  word: string;
  team: Team;
  outcome: GuessOutcome;
  created_at: Date;
}

export interface RevealedRow {
  game_id: string;
  word: string;
  team: Team | "assassin";
  revealed_by: string;
  revealed_at: Date;
}

function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function buildBoard(): { red: string[]; blue: string[]; neutral: string[]; assassin: string } {
  // Red starts, so red receives the extra card under Codenames rules.
  const words = shuffled(WORD_BANK).slice(0, 25);
  return {
    red: words.slice(0, 9),
    blue: words.slice(9, 17),
    neutral: words.slice(17, 24),
    assassin: words[24],
  };
}

const pools = new Map<string, PoolType>();

export function getPool(connectionString: string): PoolType {
  let pool = pools.get(connectionString);
  if (!pool) {
    pool = new Pool(dbPoolOptions(connectionString));
    pools.set(connectionString, pool);
  }
  return pool;
}

export async function closePool(): Promise<void> {
  await Promise.all([...pools.values()].map((p) => p.end()));
  pools.clear();
}

export async function createGame(pool: PoolType, input: { id: string; session_id: string; host_id: string }): Promise<GameRow> {
  // Seed the secret board at creation time. Before this fix every new game
  // had empty word lists and could never be played.
  const board = buildBoard();
  const result = await pool.query<GameRow>(`INSERT INTO codenames_games
     (id, session_id, host_id, red_team_words, blue_team_words, neutral_words, assassin_word)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, session_id, host_id, red_team_words, blue_team_words, neutral_words, assassin_word, status, current_team, winner, created_at, ended_at`,
  [input.id, input.session_id, input.host_id, board.red, board.blue, board.neutral, board.assassin]);
  return result.rows[0]!;
}

export async function getGame(pool: Queryable, id: string): Promise<GameRow | undefined> {
  const result = await pool.query<GameRow>(`SELECT id, session_id, host_id, red_team_words, blue_team_words, neutral_words, assassin_word, status, current_team, winner, created_at, ended_at
     FROM codenames_games WHERE id = $1`, [id]);
  return result.rows[0];
}

export async function setGameStatus(pool: Queryable, id: string, status: GameStatus): Promise<void> {
  await pool.query(`UPDATE codenames_games SET status = $2 WHERE id = $1`, [id, status]);
}

export async function submitClue(pool: PoolType, input: { id: string; game_id: string; spymaster_id: string; word: string; number: number }): Promise<ClueRow> {
  const result = await pool.query<ClueRow>(`INSERT INTO codenames_clues (id, game_id, spymaster_id, word, number)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, game_id, spymaster_id, word, number, created_at`, [input.id, input.game_id, input.spymaster_id, input.word, input.number]);
  return result.rows[0]!;
}

export async function getCluesForGame(pool: PoolType, gameId: string): Promise<ClueRow[]> {
  const result = await pool.query<ClueRow>(`SELECT id, game_id, spymaster_id, word, number, created_at
     FROM codenames_clues WHERE game_id = $1
     ORDER BY created_at DESC`, [gameId]);
  return result.rows;
}

// A correct guess or the assassin also reveals a card and ends the game.
// submitGuess owns the whole read-modify-write chain in one transaction so a
// dropped connection cannot leave a recorded guess with no matching game state.
export async function submitGuess(pool: PoolType, input: {
  id: string;
  game_id: string;
  user_id: string;
  username: string;
  word: string;
  team: Team;
  outcome: GuessOutcome;
  winner: Team | null;
  next_team: Team;
}): Promise<GuessRow> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<GuessRow>(`INSERT INTO codenames_guesses (id, game_id, user_id, username, word, team, outcome)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, game_id, user_id, username, word, team, outcome, created_at`, [input.id, input.game_id, input.user_id, input.username, input.word, input.team, input.outcome]);
    const guess = result.rows[0]!;
    if (input.outcome === "correct" || input.outcome === "assassin") {
      // The assassin belongs to neither team; record it as such rather
      // than pretending it was printed for the winning side.
      await revealWord(client, {
        game_id: input.game_id,
        word: input.word,
        team: input.outcome === "assassin" ? "assassin" : input.team,
        revealed_by: input.user_id,
      });
      await setGameStatus(client, input.game_id, "ended");
      await setGameWinner(client, input.game_id, input.winner);
    } else if (input.outcome === "wrong_team" || input.outcome === "neutral") {
      await setCurrentTeam(client, input.game_id, input.next_team);
    }
    await client.query("COMMIT");
    return guess;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listGuessesForGame(pool: PoolType, gameId: string): Promise<GuessRow[]> {
  const result = await pool.query<GuessRow>(`SELECT id, game_id, user_id, username, word, team, outcome, created_at
     FROM codenames_guesses WHERE game_id = $1
     ORDER BY created_at ASC`, [gameId]);
  return result.rows;
}

export async function listRevealedWords(pool: PoolType, gameId: string): Promise<RevealedRow[]> {
  const result = await pool.query<RevealedRow>(`SELECT game_id, word, team, revealed_by, revealed_at
     FROM codenames_revealed WHERE game_id = $1
     ORDER BY revealed_at ASC`, [gameId]);
  return result.rows;
}

export async function revealWord(pool: Queryable, input: { game_id: string; word: string; team: Team | "assassin"; revealed_by: string }): Promise<RevealedRow | null> {
  // `pool` may be a checked-out client so submitGuess can keep the reveal in
  // the same transaction as the guess and the game state change.
  const result = await pool.query<RevealedRow>(`INSERT INTO codenames_revealed (game_id, word, team, revealed_by, revealed_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (game_id, word) DO NOTHING
     RETURNING game_id, word, team, revealed_by, revealed_at`, [input.game_id, input.word, input.team, input.revealed_by]);
  return result.rows[0] ?? null;
}

export async function setCurrentTeam(pool: Queryable, id: string, team: Team): Promise<void> {
  await pool.query(`UPDATE codenames_games SET current_team = $2 WHERE id = $1`, [id, team]);
}

export async function setGameWinner(pool: Queryable, id: string, winner: Team | null): Promise<void> {
  await pool.query(`UPDATE codenames_games SET winner = $2 WHERE id = $1`, [id, winner]);
}
