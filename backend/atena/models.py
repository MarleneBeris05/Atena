from typing import Annotated, Literal

from pydantic import BaseModel, Field, SecretStr, StringConstraints, field_validator, model_validator


ResourceId = Annotated[str, StringConstraints(min_length=1, max_length=128, pattern=r"^[a-zA-Z0-9_-]+$")]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
Text = Annotated[str, StringConstraints(max_length=24000)]
RequiredText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=24000)]


class Credentials(BaseModel):
    email: Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, max_length=254,
                                           pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")]
    password: Annotated[SecretStr, Field(min_length=1, max_length=128)]


class Register(Credentials):
    password: Annotated[SecretStr, Field(min_length=12, max_length=128)]


class Subject(BaseModel):
    id: ResourceId
    name: Name
    description: Text = ""


class Topic(Subject):
    subjectId: ResourceId
    category: Text = ""


class Recall(BaseModel):
    id: ResourceId
    topicId: ResourceId
    type: Literal["recall"]
    name: Name
    question: RequiredText


class Flashcard(BaseModel):
    id: ResourceId
    topicId: ResourceId
    type: Literal["flashcard"]
    question: RequiredText
    answer: RequiredText


class Choice(BaseModel):
    id: ResourceId
    topicId: ResourceId
    type: Literal["choice"] = "choice"
    name: Name
    question: RequiredText
    options: Annotated[list[RequiredText], Field(min_length=2, max_length=20)]
    correct: Annotated[int, Field(ge=0)]
    explanation: Text = ""

    @model_validator(mode="after")
    def check_correct(self):
        if self.correct >= len(self.options):
            raise ValueError("Incorrect option index")
        return self


Review = Annotated[Recall | Flashcard | Choice, Field(discriminator="type")]


class Library(BaseModel):
    subjects: list[Subject]
    topics: list[Topic]
    reviews: list[Review]


class ImportLibrary(Library):
    @field_validator("subjects", "topics", "reviews")
    @classmethod
    def unique_ids(cls, entries):
        if len({entry.id for entry in entries}) != len(entries):
            raise ValueError("Duplicate resource IDs")
        return entries
