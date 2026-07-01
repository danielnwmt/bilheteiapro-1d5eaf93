export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      analise_cache: {
        Row: {
          casa: string
          created_at: string
          dia: string
          id: string
          partida_id: string
          payload: Json
        }
        Insert: {
          casa?: string
          created_at?: string
          dia: string
          id?: string
          partida_id: string
          payload: Json
        }
        Update: {
          casa?: string
          created_at?: string
          dia?: string
          id?: string
          partida_id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "analise_cache_partida_id_fkey"
            columns: ["partida_id"]
            isOneToOne: false
            referencedRelation: "partidas"
            referencedColumns: ["id"]
          },
        ]
      }
      api_usage: {
        Row: {
          chave: string
          dia: string
          total: number
          ultima_chamada: string | null
        }
        Insert: {
          chave: string
          dia?: string
          total?: number
          ultima_chamada?: string | null
        }
        Update: {
          chave?: string
          dia?: string
          total?: number
          ultima_chamada?: string | null
        }
        Relationships: []
      }
      banca_depositos: {
        Row: {
          created_at: string
          data: string
          descricao: string
          id: string
          updated_at: string
          user_id: string
          valor: number
        }
        Insert: {
          created_at?: string
          data?: string
          descricao?: string
          id?: string
          updated_at?: string
          user_id: string
          valor?: number
        }
        Update: {
          created_at?: string
          data?: string
          descricao?: string
          id?: string
          updated_at?: string
          user_id?: string
          valor?: number
        }
        Relationships: []
      }
      banca_entradas: {
        Row: {
          created_at: string
          data: string
          descricao: string
          esporte: string
          id: string
          odd: number
          resultado: string
          updated_at: string
          user_id: string
          valor: number
        }
        Insert: {
          created_at?: string
          data?: string
          descricao: string
          esporte?: string
          id?: string
          odd?: number
          resultado?: string
          updated_at?: string
          user_id: string
          valor?: number
        }
        Update: {
          created_at?: string
          data?: string
          descricao?: string
          esporte?: string
          id?: string
          odd?: number
          resultado?: string
          updated_at?: string
          user_id?: string
          valor?: number
        }
        Relationships: []
      }
      bilhetes: {
        Row: {
          casa: string
          confianca: number
          created_at: string
          id: string
          observacoes: string | null
          odd_total: number
          periodo: string | null
          resumo: string
          risco: string
          tipo: string
          updated_at: string
          url_deeplink: string | null
          user_id: string | null
        }
        Insert: {
          casa?: string
          confianca?: number
          created_at?: string
          id?: string
          observacoes?: string | null
          odd_total?: number
          periodo?: string | null
          resumo?: string
          risco?: string
          tipo?: string
          updated_at?: string
          url_deeplink?: string | null
          user_id?: string | null
        }
        Update: {
          casa?: string
          confianca?: number
          created_at?: string
          id?: string
          observacoes?: string | null
          odd_total?: number
          periodo?: string | null
          resumo?: string
          risco?: string
          tipo?: string
          updated_at?: string
          url_deeplink?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      deep_links: {
        Row: {
          casa: string
          created_at: string
          id: string
          mercado: string | null
          updated_at: string
          url_template: string
        }
        Insert: {
          casa: string
          created_at?: string
          id?: string
          mercado?: string | null
          updated_at?: string
          url_template: string
        }
        Update: {
          casa?: string
          created_at?: string
          id?: string
          mercado?: string | null
          updated_at?: string
          url_template?: string
        }
        Relationships: []
      }
      estatisticas: {
        Row: {
          created_at: string
          id: string
          partida_id: string | null
          payload: Json
          tipo: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          partida_id?: string | null
          payload?: Json
          tipo?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          partida_id?: string | null
          payload?: Json
          tipo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "estatisticas_partida_id_fkey"
            columns: ["partida_id"]
            isOneToOne: false
            referencedRelation: "partidas"
            referencedColumns: ["id"]
          },
        ]
      }
      odds: {
        Row: {
          casa: string
          created_at: string
          deep_link: string | null
          external_odd_id: string | null
          id: string
          mercado: string
          partida_id: string | null
          selecao: string
          updated_at: string
          valor: number
        }
        Insert: {
          casa: string
          created_at?: string
          deep_link?: string | null
          external_odd_id?: string | null
          id?: string
          mercado: string
          partida_id?: string | null
          selecao: string
          updated_at?: string
          valor: number
        }
        Update: {
          casa?: string
          created_at?: string
          deep_link?: string | null
          external_odd_id?: string | null
          id?: string
          mercado?: string
          partida_id?: string | null
          selecao?: string
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "odds_partida_id_fkey"
            columns: ["partida_id"]
            isOneToOne: false
            referencedRelation: "partidas"
            referencedColumns: ["id"]
          },
        ]
      }
      palpites: {
        Row: {
          bilhete_id: string | null
          confianca: number
          created_at: string
          deep_link: string | null
          id: string
          justificativa: string | null
          mercado: string
          odd: number
          partida_id: string | null
          selecao: string
        }
        Insert: {
          bilhete_id?: string | null
          confianca: number
          created_at?: string
          deep_link?: string | null
          id?: string
          justificativa?: string | null
          mercado: string
          odd: number
          partida_id?: string | null
          selecao: string
        }
        Update: {
          bilhete_id?: string | null
          confianca?: number
          created_at?: string
          deep_link?: string | null
          id?: string
          justificativa?: string | null
          mercado?: string
          odd?: number
          partida_id?: string | null
          selecao?: string
        }
        Relationships: [
          {
            foreignKeyName: "palpites_bilhete_id_fkey"
            columns: ["bilhete_id"]
            isOneToOne: false
            referencedRelation: "bilhetes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "palpites_partida_id_fkey"
            columns: ["partida_id"]
            isOneToOne: false
            referencedRelation: "partidas"
            referencedColumns: ["id"]
          },
        ]
      }
      partidas: {
        Row: {
          arbitro: string | null
          created_at: string
          external_id: string | null
          flashscore_id: string | null
          id: string
          inicio: string
          liga: string | null
          status: string
          time_casa: string
          time_fora: string
          updated_at: string
        }
        Insert: {
          arbitro?: string | null
          created_at?: string
          external_id?: string | null
          flashscore_id?: string | null
          id?: string
          inicio: string
          liga?: string | null
          status?: string
          time_casa: string
          time_fora: string
          updated_at?: string
        }
        Update: {
          arbitro?: string | null
          created_at?: string
          external_id?: string | null
          flashscore_id?: string | null
          id?: string
          inicio?: string
          liga?: string | null
          status?: string
          time_casa?: string
          time_fora?: string
          updated_at?: string
        }
        Relationships: []
      }
      plano_config: {
        Row: {
          created_at: string
          desconto_anual: number
          desconto_semestral: number
          descricao: string
          historico_dias: number
          ligas: Json
          nivel: number
          nome: string
          plano: string
          preco: string
          recursos: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          desconto_anual?: number
          desconto_semestral?: number
          descricao: string
          historico_dias?: number
          ligas?: Json
          nivel: number
          nome: string
          plano: string
          preco: string
          recursos?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          desconto_anual?: number
          desconto_semestral?: number
          descricao?: string
          historico_dias?: number
          ligas?: Json
          nivel?: number
          nome?: string
          plano?: string
          preco?: string
          recursos?: Json
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          cpf: string | null
          created_at: string
          data_nascimento: string | null
          email: string | null
          id: string
          last_seen: string | null
          nome: string | null
          telefone: string | null
          updated_at: string
        }
        Insert: {
          cpf?: string | null
          created_at?: string
          data_nascimento?: string | null
          email?: string | null
          id: string
          last_seen?: string | null
          nome?: string | null
          telefone?: string | null
          updated_at?: string
        }
        Update: {
          cpf?: string | null
          created_at?: string
          data_nascimento?: string | null
          email?: string | null
          id?: string
          last_seen?: string | null
          nome?: string | null
          telefone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          external_subscription_id: string | null
          id: string
          periodo_fim: string | null
          plano: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          external_subscription_id?: string | null
          id?: string
          periodo_fim?: string | null
          plano: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          external_subscription_id?: string | null
          id?: string
          periodo_fim?: string | null
          plano?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sync_state: {
        Row: {
          id: string
          last_sync_at: string | null
          updated_at: string
        }
        Insert: {
          id: string
          last_sync_at?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          last_sync_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      system_config: {
        Row: {
          chave: string
          descricao: string | null
          updated_at: string
          valor: string | null
        }
        Insert: {
          chave: string
          descricao?: string | null
          updated_at?: string
          valor?: string | null
        }
        Update: {
          chave?: string
          descricao?: string | null
          updated_at?: string
          valor?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_list_users: {
        Args: never
        Returns: {
          cpf: string
          created_at: string
          data_nascimento: string
          email: string
          id: string
          nome: string
          periodo_fim: string
          plano: string
          roles: string[]
          status: string
          telefone: string
        }[]
      }
      increment_api_usage: { Args: { _chave: string }; Returns: undefined }
      touch_last_seen: { Args: never; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "operador" | "cliente"
      plano_tipo: "start" | "pro" | "elite"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "operador", "cliente"],
      plano_tipo: ["start", "pro", "elite"],
    },
  },
} as const
