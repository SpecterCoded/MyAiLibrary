import json


def generate_fake_embedding(text: str):

    length = len(text)

    words = len(text.split())

    embedding = [length, words, length % 100, words % 100]

    return json.dumps(embedding)


def calculate_similarity(vector1, vector2):

    score = 0

    for a, b in zip(vector1, vector2):
        score += abs(a - b)

    return score
